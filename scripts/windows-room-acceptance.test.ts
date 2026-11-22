import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { observeRoom } from "./acceptance/room-journey.mjs";
import {
  sha256Hex,
  verifyLocalRunEvidence,
} from "./local-runner-message-evidence.mjs";

const route = "/v0/rooms/room";
const sourceRuns = `${route}/runtime-presentation-runs?message_id=source`;
const replyRuns = `${route}/runtime-presentation-runs?message_id=reply`;
const run = { run_id: "run", room_id: "room", agent: { id: "agent" } };
const completed = { ...run, status: "completed" };
const replyMarker = "LINGER_REPLY_0123456789ABCDEF";
const replyDigest = sha256Hex(replyMarker);
const reply = {
  id: "reply",
  raw_message: replyMarker,
  author: { id: "agent" },
};

function observe(
  pages: Record<string, unknown[]>,
  verify = vi.fn().mockResolvedValue(true),
) {
  const get = vi.fn(async (url: string, _signal: AbortSignal) => ({
    items: pages[url]?.shift() ?? [],
  }));
  let time = 0;
  const result = observeRoom({
    get,
    roomID: "room",
    messageID: "source",
    agentID: "agent",
    expectedReplySha256: replyDigest,
    verify,
    signal: new AbortController().signal,
    wait: async () => {
      if (++time === 4) throw new Error("deadline");
    },
  });
  return { get, verify, result };
}

it("returns a persisted abort immediately without querying replies", async () => {
  const { get, verify, result } = observe({
    [sourceRuns]: [[{ ...run, status: "aborted" }]],
  });
  await expect(result).resolves.toEqual({ outcome: "aborted", runID: "run" });
  expect(get.mock.calls).toEqual([[sourceRuns, expect.any(AbortSignal)]]);
  expect(verify).not.toHaveBeenCalled();
});

it("ignores active and unrelated runs, then waits for linked evidence", async () => {
  const verify = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const { get, result } = observe(
    {
      [sourceRuns]: [
        [
          { ...run, status: "active", replied: true },
          { ...run, status: "aborted", room_id: "other" },
          { ...run, status: "aborted", agent: { id: "other" } },
        ],
        [completed],
        [completed],
      ],
      [`${route}/messages`]: [[reply], [reply]],
      [replyRuns]: [[completed], [completed]],
    },
    verify,
  );
  await expect(result).resolves.toEqual({
    outcome: "verified",
    runID: "run",
    replyID: "reply",
  });
  expect(get.mock.calls.map(([url]) => url)).toEqual([
    sourceRuns,
    sourceRuns,
    `${route}/messages`,
    replyRuns,
    sourceRuns,
    `${route}/messages`,
    replyRuns,
  ]);
  expect(verify).toHaveBeenCalledTimes(2);
});

it("does not accept a reply from a different run or digest", async () => {
  const wrongRun = observe({
    [sourceRuns]: [[completed]],
    [`${route}/messages`]: [[reply]],
    [replyRuns]: [[{ ...completed, run_id: "other" }]],
  });
  await expect(wrongRun.result).rejects.toThrow("deadline");
  expect(wrongRun.verify).not.toHaveBeenCalled();

  const wrongDigest = observe({
    [sourceRuns]: [[completed]],
    [`${route}/messages`]: [[{ ...reply, raw_message: "other-digest" }]],
    [replyRuns]: [[completed]],
  });
  await expect(wrongDigest.result).rejects.toThrow("deadline");
  expect(wrongDigest.verify).not.toHaveBeenCalled();
});

it("exits nonzero with the matching IDs before waiting for a reply", async () => {
  const root = await mkdtemp(join(tmpdir(), "acceptance-room-"));
  const requests: string[] = [];
  const payloads = new Map<string, object>([
    ["/v0/auth/login", { identity: { actors: [{ tenant_id: "tenant" }] } }],
    [
      "/v0/tenants/tenant/local-computers",
      {
        items: [
          {
            computer_id: "computer",
            status: "online",
            runtimes: [
              { type: "pi", status: "ready", models: [{ id: "model" }] },
            ],
            workspace_grants: [{ mode: "workspace-write", grant_id: "grant" }],
          },
        ],
      },
    ],
    [
      "/v0/tenants/tenant/agents",
      { actor: { id: "agent" }, agent_management_id: "agent-management" },
    ],
    ["/v0/tenants/tenant/direct-rooms", { id: "room" }],
    [`${route}/messages`, { id: "source" }],
    [sourceRuns, { items: [{ ...run, status: "aborted" }] }],
  ]);
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    requests.push(url);
    if (url === "/v0/auth/login")
      response.setHeader("Set-Cookie", "fixture=yes");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payloads.get(url)));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    const owner = join(root, "owner.json");
    await writeFile(
      owner,
      '{"owner_email":"owner@example.test","owner_password":"fixture-only"}',
      { mode: 0o600 },
    );
    const entry = fileURLToPath(
      new URL("./acceptance/room-journey.mjs", import.meta.url),
    );
    try {
      await promisify(execFile)(process.execPath, [entry], {
        timeout: 5_000,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("LINGER_ACCEPTANCE_"),
            ),
          ),
          LINGER_ACCEPTANCE_BASE_URL: `http://127.0.0.1:${address.port}`,
          LINGER_ACCEPTANCE_OWNER_FILE: owner,
          LINGER_ACCEPTANCE_COMPUTER_ID: "computer",
          LINGER_ACCEPTANCE_CONTEXT_VIEWS: join(root, "context-views"),
          LINGER_ACCEPTANCE_AGENT_LOG_ROOT: join(root, "logs"),
          LINGER_ACCEPTANCE_TIMEOUT_SECONDS: "10",
        },
      });
      throw new Error("Unexpected successful exit");
    } catch (error) {
      const result = error as { code: unknown; stdout: string };
      expect(result.code).toBe(1);
      const terminal = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
      expect(terminal).toMatchObject({
        phase: "aborted",
        room_id: "room",
        message_id: "source",
        agent_id: "agent",
        run_id: "run",
      });
    }
    expect(requests).toEqual([...payloads.keys()]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

it("requires exact bytes, regular files, and both events from the same run", async () => {
  const root = await mkdtemp(join(tmpdir(), "acceptance-evidence-"));
  try {
    const marker = "LINGER_ACCEPTANCE_0123456789ABCDEF";
    const file = join(root, "marker.txt");
    const link = join(root, "marker-link.txt");
    const log = join(root, "events.ndjson");
    const write = {
      event: "agent.tool_call",
      tool_name: "write",
      is_error: false,
    };
    const terminal = {
      event: "local_run.terminal_persisted",
      resultCode: "succeeded",
    };
    const verify = () =>
      verifyLocalRunEvidence({ file, expected: marker, log, runId: "run" });
    await expect(verify()).resolves.toBe(false);
    await writeFile(file, marker);
    await expect(verify()).resolves.toBe(false);
    await writeFile(
      log,
      `${JSON.stringify({ ...write, runId: "run" })}\n${JSON.stringify({ ...terminal, runId: "other" })}\n`,
    );
    await expect(verify()).resolves.toBe(false);
    await writeFile(
      log,
      `${JSON.stringify({ ...write, runId: "run" })}\n${JSON.stringify({ ...terminal, runId: "run" })}\n`,
    );
    await expect(verify()).resolves.toBe(true);
    await expect(
      verifyLocalRunEvidence({
        file,
        expectedSha256: sha256Hex(marker),
        log,
        runId: "run",
      }),
    ).resolves.toBe(true);

    const cli = fileURLToPath(
      new URL("./local-runner-message-evidence.mjs", import.meta.url),
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [cli, "--run-evidence"],
      {
        timeout: 5_000,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("LINGER_ACCEPTANCE_"),
            ),
          ),
          LINGER_ACCEPTANCE_FILE: file,
          LINGER_ACCEPTANCE_EXPECTED: marker,
          LINGER_ACCEPTANCE_AGENT_LOG: log,
          LINGER_ACCEPTANCE_RUN_ID: "run",
        },
      },
    );
    expect(JSON.parse(stdout)).toEqual({
      result: "verified",
      run_id: "run",
      file_sha256: sha256Hex(marker),
      file_content: "exact",
      successful_write: true,
      terminal_succeeded: true,
    });

    await symlink(file, link);
    await expect(
      verifyLocalRunEvidence({
        file: link,
        expected: marker,
        log,
        runId: "run",
      }),
    ).rejects.toThrow("INVALID_ARTIFACT_FILE");

    await writeFile(file, `${marker}\r\n`);
    await expect(verify()).resolves.toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
