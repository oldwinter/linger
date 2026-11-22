import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  sha256Hex,
  verifyLocalRunEvidence,
} from "../local-runner-message-evidence.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function observeRoom({
  get,
  roomID,
  messageID,
  agentID,
  expectedReplySha256,
  verify,
  signal,
  wait = () => delay(1000, undefined, { signal }),
}) {
  const room = `/v0/rooms/${encodeURIComponent(roomID)}`;
  const runs = async (id) => {
    const page = await get(
      `${room}/runtime-presentation-runs?message_id=${encodeURIComponent(id)}`,
      signal,
    );
    return page.items.filter(
      (item) => item.room_id === roomID && item.agent?.id === agentID,
    );
  };
  for (;;) {
    signal.throwIfAborted();
    const observed = await runs(messageID);
    const aborted = observed.find((item) => item.status === "aborted");
    if (aborted) return { outcome: "aborted", runID: aborted.run_id };
    const completed = observed.filter((item) => item.status === "completed");
    if (completed.length) {
      const page = await get(`${room}/messages`, signal);
      for (const reply of page.items) {
        if (reply.author?.id !== agentID) continue;
        if (
          expectedReplySha256 &&
          (typeof reply.raw_message !== "string" ||
            sha256Hex(reply.raw_message.trim()) !== expectedReplySha256)
        )
          continue;
        const linked = await runs(reply.id);
        for (const { run_id: runID } of completed) {
          if (
            !linked.some(
              (item) => item.run_id === runID && item.status === "completed",
            )
          )
            continue;
          if (!verify)
            return { outcome: "room_observed", runID, replyID: reply.id };
          if (await verify(runID, signal))
            return { outcome: "verified", runID, replyID: reply.id };
        }
      }
    }
    await wait();
  }
}

async function main() {
  const base = new URL(required("LINGER_ACCEPTANCE_BASE_URL"));
  if (
    !["http:", "https:"].includes(base.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("The test server must be a loopback HTTP(S) origin");
  const timeoutSeconds = Number(
    process.env.LINGER_ACCEPTANCE_TIMEOUT_SECONDS ?? 180,
  );
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 10 ||
    timeoutSeconds > 600
  )
    throw new Error(
      "LINGER_ACCEPTANCE_TIMEOUT_SECONDS must be an integer from 10 to 600",
    );
  const computerID = required("LINGER_ACCEPTANCE_COMPUTER_ID");
  const ownerText = await readFile(
    required("LINGER_ACCEPTANCE_OWNER_FILE"),
    "utf8",
  );
  let owner;
  try {
    owner = JSON.parse(ownerText);
  } catch {
    throw new Error("Owner file is not valid JSON");
  }
  if (
    typeof owner?.owner_email !== "string" ||
    typeof owner.owner_password !== "string"
  )
    throw new Error("Owner file does not contain local owner credentials");
  const workspace = process.env.LINGER_ACCEPTANCE_WORKSPACE?.trim();
  const views = process.env.LINGER_ACCEPTANCE_CONTEXT_VIEWS?.trim();
  const log = process.env.LINGER_ACCEPTANCE_AGENT_LOG?.trim();
  const logRoot = process.env.LINGER_ACCEPTANCE_AGENT_LOG_ROOT?.trim();
  if (
    (workspace && views) ||
    (log && logRoot) ||
    Boolean(workspace || views) !== Boolean(log || logRoot) ||
    [workspace, views, log, logRoot].some(
      (entry) => entry && !isAbsolute(entry),
    )
  )
    throw new Error(
      "Provide one absolute workspace or context-views path and one absolute Agent log or log-root path",
    );

  async function request(route, body, cookie, signal) {
    const requestTimeout = AbortSignal.timeout(15_000);
    const response = await fetch(base.origin + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "Idempotency-Key": randomUUID(),
            }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, requestTimeout])
        : requestTimeout,
    });
    if (!response.ok)
      throw new Error(
        `HTTP ${response.status} from ${route.replace(/\/v0\/rooms\/[^/]+/, "/v0/rooms/{room}")}`,
      );
    return response;
  }

  const login = await request("/v0/auth/login", {
    identifier: owner.owner_email,
    password: owner.owner_password,
  });
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Login returned no session cookie");
  const { identity } = await login.json();
  const actor = identity?.actors?.find((item) => item.tenant_id);
  if (!actor) throw new Error("Login returned no tenant actor");
  const tenant = encodeURIComponent(actor.tenant_id);
  const get = async (route, signal) =>
    (await request(route, undefined, cookie, signal)).json();
  const post = async (route, body) =>
    (await request(route, body, cookie)).json();
  const inventory = await get(`/v0/tenants/${tenant}/local-computers`);
  const computer = inventory.items?.find(
    (item) => item.computer_id === computerID,
  );
  if (!computer || computer.status !== "online")
    throw new Error("Selected Computer is not online");
  const pi = computer.runtimes?.find(
    (runtime) => runtime.type === "pi" && runtime.status === "ready",
  );
  if (!pi?.models?.length)
    throw new Error("Selected Computer has no ready Pi model");
  const requestedModel = process.env.LINGER_ACCEPTANCE_MODEL?.trim();
  const model = requestedModel
    ? pi.models.find((entry) => entry.id === requestedModel)
    : (pi.models.find((entry) => entry.is_default) ?? pi.models[0]);
  if (!model)
    throw new Error("Requested model is absent from the Computer catalog");
  const grant = computer.workspace_grants?.find(
    (entry) => entry.mode === "workspace-write",
  );
  if (!grant)
    throw new Error("Selected Computer has no writable workspace grant");

  const suffix = randomBytes(8).toString("hex");
  const filename = `linger-acceptance-${suffix}.txt`;
  const marker = `LINGER_ACCEPTANCE_${suffix.toUpperCase()}`;
  const reply = `LINGER_REPLY_${suffix.toUpperCase()}`;
  const expectedFileSha256 = sha256Hex(marker);
  const expectedReplySha256 = sha256Hex(reply);
  const name = `Linger Acceptance ${suffix}`;
  const agent = await post(`/v0/tenants/${tenant}/agents`, {
    name,
    instructions:
      "Complete the user request using the provided tools. Report the result concisely.",
    runtime: {
      model: model.id,
      placement: {
        type: "local",
        computer_id: computerID,
        runtime_type: "pi",
        workspace_grant_id: grant.grant_id,
      },
    },
  });
  const agentID = agent.actor.id;
  const managementID = agent.agent_management_id;
  if (logRoot && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(managementID ?? ""))
    throw new Error("Agent creation did not return a valid management ID");
  const agentLog =
    log ?? (logRoot && join(logRoot, "agents", managementID, "events.ndjson"));
  const verify =
    agentLog &&
    (async (runID, signal) => {
      if (workspace)
        return verifyLocalRunEvidence({
          file: join(workspace, filename),
          expected: marker,
          log: agentLog,
          runId: runID,
          signal,
        });
      const entries = await readdir(views, { withFileTypes: true });
      for (const entry of entries) {
        signal.throwIfAborted();
        if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name))
          continue;
        const file = join(views, entry.name, "workspace", filename);
        if (
          await verifyLocalRunEvidence({
            file,
            expected: marker,
            log: agentLog,
            runId: runID,
            signal,
          })
        )
          return true;
      }
      return false;
    });
  const room = await post(`/v0/tenants/${tenant}/direct-rooms`, {
    peer_actor_id: agentID,
  });
  const mention = `@${name}`;
  const text = `Use your write tool to create ${filename} in the current workspace with exactly ${marker} as its complete content. Then send a Room reply whose entire content is exactly ${reply} and nothing else.`;
  const message = await post(
    `/v0/rooms/${encodeURIComponent(room.id)}/messages`,
    {
      raw_message: `${mention} ${text}`,
      segments: [
        {
          type: "reference",
          content: mention,
          target: agentID,
          target_type: "agent",
        },
        { type: "text", content: ` ${text}` },
      ],
    },
  );
  const ids = {
    computer_id: computerID,
    agent_id: agentID,
    room_id: room.id,
    message_id: message.id,
  };
  console.log(
    JSON.stringify({
      phase: "sent",
      ...ids,
      model: model.id,
      filename,
      expected_file_content: marker,
      expected_file_sha256: expectedFileSha256,
      expected_reply: reply,
      expected_reply_sha256: expectedReplySha256,
    }),
  );
  const sentAt = performance.now();
  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  const result = await observeRoom({
    get,
    roomID: room.id,
    messageID: message.id,
    agentID,
    expectedReplySha256,
    signal,
    verify,
  }).catch((error) => {
    if (signal.aborted) {
      console.log(
        JSON.stringify({
          phase: "timed_out",
          ...ids,
          elapsed_ms: Math.round(performance.now() - sentAt),
        }),
      );
      throw new Error(
        `Room evidence incomplete after ${timeoutSeconds} seconds`,
      );
    }
    throw error;
  });
  console.log(
    JSON.stringify({
      phase: result.outcome,
      ...ids,
      run_id: result.runID,
      reply_id: result.replyID,
      elapsed_ms: Math.round(performance.now() - sentAt),
    }),
  );
  if (result.outcome === "aborted") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Acceptance journey failed: ${error.message}`);
    process.exitCode = 1;
  });
}
