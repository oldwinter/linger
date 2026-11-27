import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentToDaemonEnvelope,
  ComputerToolCall,
} from "@linger/wire-contracts/runner-gateway/types";
import {
  attachHerdrCoreStreamRelay,
  HERDR_CORE_CLIENT_ATTACH_PATH,
  HERDR_CORE_DAEMON_STREAM_PATH,
  signHerdrCoreAttachToken,
  verifyHerdrCoreAttachToken,
  type HerdrCoreAttachTokenClaims,
} from "../../../src/agent/runner-gateway/runner-herdr-core-stream.js";
import { attachRunnerGatewayWebSocket } from "../../../src/agent/runner-gateway/runner-gateway-websocket.js";
import type { RunnerCredentialAuthenticator } from "../../../src/agent/runner-gateway/runner-credential-authority.js";
import type { RunnerGatewayConnection } from "../../../src/agent/runner-gateway/runner-gateway.js";
import { createTestRunnerGateway } from "../test-support/runner-gateway.js";
import { runtimeDiagnostics } from "./runtime-diagnostics-fixture.js";
import {
  CURRENT_RUNNER_CAPABILITIES,
  currentRunnerIdentity,
} from "../test-support/runner-capabilities.js";

const SIGNING_KEY = "test-herdr-core-attach-signing-key";
const RUNNER_TOKEN = "runner-token-hc-1";

interface ReceivedFrame {
  readonly isBinary: boolean;
  readonly data: Buffer;
}

function makeQueue(ws: WebSocket) {
  const frames: ReceivedFrame[] = [];
  const waiters: Array<(frame: ReceivedFrame) => void> = [];
  ws.on("message", (raw, isBinary) => {
    const data = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw);
    const frame: ReceivedFrame = { isBinary, data };
    const next = waiters.shift();
    if (next) next(frame);
    else frames.push(frame);
  });
  return {
    next: (): Promise<ReceivedFrame> => {
      const existing = frames.shift();
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for WebSocket frame")),
          5_000,
        );
        waiters.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      });
    },
    pendingCount: () => frames.length,
  };
}

function nextClaims(
  overrides: Partial<HerdrCoreAttachTokenClaims> = {},
): HerdrCoreAttachTokenClaims {
  return {
    v: 1,
    session_id: `sess-${Math.random().toString(16).slice(2, 10)}`,
    computer_id: "computer-hc",
    tenant_id: "tenant-1",
    owner_actor_id: "actor-1",
    address: "vps/t7",
    cols: 120,
    rows: 36,
    observe: true,
    history: 200,
    exp: Math.floor(Date.now() / 1_000) + 60,
    ...overrides,
  };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn().catch(() => undefined);
  }
});

async function startHarness(options?: {
  clientHighWaterBytes?: number;
  clientHardLimitBytes?: number;
}) {
  const gateway = createTestRunnerGateway({ heartbeatIntervalMs: 60_000 });
  const sentToDaemon: AgentToDaemonEnvelope[] = [];
  const connection: RunnerGatewayConnection = await gateway.acceptConnection(
    {
      runnerId: "computer-hc",
      credentialGeneration: 0,
      tenantOwners: [{ tenantId: "tenant-1", ownerActorId: "actor-1" }],
    },
    {
      type: "runner.hello",
      platform: "darwin",
      protocol_version: "2",
      daemon_version: "dev",
      ...currentRunnerIdentity(),
      capabilities: [...CURRENT_RUNNER_CAPABILITIES],
      runner_id: "computer-hc",
      display_name: "Workstation",
      connection_nonce: "nonce-stream-1",
      sent_at: new Date().toISOString(),
      runtimes: ["codex"],
      runtime_diagnostics: runtimeDiagnostics(),
      workspace_grants: [],
      agent_runners: [],
      active_operations: [],
    },
    {
      send: vi.fn(async (envelope: AgentToDaemonEnvelope) => {
        sentToDaemon.push(envelope);
      }),
      close: vi.fn(),
    },
  );
  cleanups.push(async () => connection.disconnect());

  const authenticator: RunnerCredentialAuthenticator = {
    authenticate: async (header) =>
      header === `Bearer ${RUNNER_TOKEN}`
        ? {
            runnerId: "computer-hc",
            token: RUNNER_TOKEN,
            credentialGeneration: 0,
            tenantOwners: [{ tenantId: "tenant-1", ownerActorId: "actor-1" }],
          }
        : null,
  };

  const server: Server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  const gatewayWs = attachRunnerGatewayWebSocket({
    server,
    gateway,
    credentialAuthenticators: [authenticator],
    ignoredPaths: [
      HERDR_CORE_DAEMON_STREAM_PATH,
      HERDR_CORE_CLIENT_ATTACH_PATH,
    ],
    rejectUnmatchedUpgrades: true,
  });
  const relay = attachHerdrCoreStreamRelay({
    server,
    gateway,
    credentialAuthenticators: [authenticator],
    attachTokenSigningKey: SIGNING_KEY,
    daemonJoinTimeoutMs: 5_000,
    ...(options?.clientHighWaterBytes === undefined
      ? {}
      : { clientHighWaterBytes: options.clientHighWaterBytes }),
    ...(options?.clientHardLimitBytes === undefined
      ? {}
      : { clientHardLimitBytes: options.clientHardLimitBytes }),
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const wsBase = `ws://127.0.0.1:${port}`;

  cleanups.push(async () => {
    await relay.close();
    await gatewayWs.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const waitForAttachToolCall = async (): Promise<ComputerToolCall> => {
    await vi.waitFor(() =>
      expect(
        sentToDaemon.some(
          (frame) =>
            frame.type === "execute" &&
            frame.kind === "computer_tool" &&
            frame.server === "herdr_core" &&
            frame.tool_name === "attach",
        ),
      ).toBe(true),
    );
    const frame = [...sentToDaemon]
      .reverse()
      .find(
        (item) =>
          item.type === "execute" &&
          item.kind === "computer_tool" &&
          item.server === "herdr_core" &&
          item.tool_name === "attach",
      );
    if (frame?.type !== "execute" || frame.kind !== "computer_tool") {
      throw new Error("Missing attach computer_tool call");
    }
    return frame;
  };

  return { gateway, connection, relay, wsBase, waitForAttachToolCall };
}

describe("HerdrCore attach token signing", () => {
  it("verifies valid tokens and rejects tampered or expired tokens", () => {
    const now = 1_732_670_400;
    const claims = nextClaims({ exp: now + 60 });
    const token = signHerdrCoreAttachToken(claims, SIGNING_KEY);
    expect(verifyHerdrCoreAttachToken(token, SIGNING_KEY, now)).toEqual(claims);
    expect(verifyHerdrCoreAttachToken(token, "wrong-key", now)).toBeNull();
    expect(verifyHerdrCoreAttachToken(token, SIGNING_KEY, now + 60)).toBeNull();
    expect(
      verifyHerdrCoreAttachToken(`${token.slice(0, -2)}AA`, SIGNING_KEY, now),
    ).toBeNull();
  });
});

describe("Independent binary PTY attach WS relay", () => {
  it("bridges binary PTY bytes, enforces observe=true server-side, and allows interactive mode after toggle", async () => {
    const { connection, wsBase, waitForAttachToolCall } = await startHarness();
    const claims = nextClaims({ observe: true });
    const token = signHerdrCoreAttachToken(claims, SIGNING_KEY);

    const clientWs = new WebSocket(
      `${wsBase}${HERDR_CORE_CLIENT_ATTACH_PATH}?token=${encodeURIComponent(token)}`,
    );
    cleanups.push(async () => clientWs.close());
    const clientQueue = makeQueue(clientWs);
    await new Promise<void>((resolve, reject) => {
      clientWs.once("open", () => resolve());
      clientWs.once("error", reject);
    });

    const attachCall = await waitForAttachToolCall();
    expect(attachCall.arguments).toMatchObject({
      session_id: claims.session_id,
      stream_path: HERDR_CORE_DAEMON_STREAM_PATH,
      address: "vps/t7",
      cols: 120,
      rows: 36,
      observe: true,
      history: 200,
    });

    // Daemon answers computer_tool attach and dials the independent stream path.
    await connection.receive({
      type: "executed",
      kind: "computer_tool",
      protocol_version: "2",
      command_id: attachCall.command_id,
      runner_id: attachCall.runner_id,
      connection_epoch: attachCall.connection_epoch,
      tenant_id: attachCall.tenant_id,
      owner_actor_id: attachCall.owner_actor_id,
      agent_id: attachCall.agent_id,
      result: { status: "accepted", session_id: claims.session_id },
    });

    const daemonWs = new WebSocket(
      `${wsBase}${HERDR_CORE_DAEMON_STREAM_PATH}?session_id=${encodeURIComponent(claims.session_id)}`,
      { headers: { authorization: `Bearer ${RUNNER_TOKEN}` } },
    );
    cleanups.push(async () => daemonWs.close());
    const daemonQueue = makeQueue(daemonWs);
    await new Promise<void>((resolve, reject) => {
      daemonWs.once("open", () => resolve());
      daemonWs.once("error", reject);
    });

    // Daemon sends attached control message and raw PTY binary bytes.
    daemonWs.send(
      JSON.stringify({
        type: "attached",
        address: "vps/t7",
        cols: 120,
        rows: 36,
        observe: true,
        resumed: false,
      }),
    );
    const attachedFrame = await clientQueue.next();
    expect(attachedFrame.isBinary).toBe(false);
    expect(JSON.parse(attachedFrame.data.toString("utf8"))).toEqual({
      type: "attached",
      address: "vps/t7",
      cols: 120,
      rows: 36,
      observe: true,
      resumed: false,
    });

    const ptyOutput = Buffer.from("\u001b[32mready>\u001b[0m ", "utf8");
    daemonWs.send(ptyOutput, { binary: true });
    const outputFrame = await clientQueue.next();
    expect(outputFrame.isBinary).toBe(true);
    expect(outputFrame.data.equals(ptyOutput)).toBe(true);

    // While observe=true, binary input and resize are rejected server-side.
    clientWs.send(Buffer.from("ls\n", "utf8"), { binary: true });
    const rejectedInput = await clientQueue.next();
    expect(JSON.parse(rejectedInput.data.toString("utf8"))).toMatchObject({
      type: "error",
      code: "OBSERVE_ONLY",
    });

    clientWs.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    const rejectedResize = await clientQueue.next();
    expect(JSON.parse(rejectedResize.data.toString("utf8"))).toMatchObject({
      type: "error",
      code: "OBSERVE_ONLY",
    });
    expect(daemonQueue.pendingCount()).toBe(0);

    // Ping is answered directly with pong.
    clientWs.send(JSON.stringify({ type: "ping" }));
    const pong = await clientQueue.next();
    expect(JSON.parse(pong.data.toString("utf8"))).toEqual({ type: "pong" });

    // Switch to interactive mode with explicit viewport dimensions; mode, focus, resize, and binary input forward to daemon.
    clientWs.send(
      JSON.stringify({ type: "mode", observe: false, cols: 112, rows: 34 }),
    );
    const daemonMode = await daemonQueue.next();
    expect(daemonMode.isBinary).toBe(false);
    expect(JSON.parse(daemonMode.data.toString("utf8"))).toEqual({
      type: "mode",
      observe: false,
      cols: 112,
      rows: 34,
    });

    clientWs.send(JSON.stringify({ type: "focus", focused: true }));
    const daemonFocus = await daemonQueue.next();
    expect(JSON.parse(daemonFocus.data.toString("utf8"))).toEqual({
      type: "focus",
      focused: true,
    });

    clientWs.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    const daemonResize = await daemonQueue.next();
    expect(JSON.parse(daemonResize.data.toString("utf8"))).toEqual({
      type: "resize",
      cols: 100,
      rows: 30,
    });

    const userInput = Buffer.from("echo ok\r", "utf8");
    clientWs.send(userInput, { binary: true });
    const daemonInput = await daemonQueue.next();
    expect(daemonInput.isBinary).toBe(true);
    expect(daemonInput.data.equals(userInput)).toBe(true);
  });

  it("rejects replayed tokens and unknown upgrade paths with HTTP errors", async () => {
    const { wsBase } = await startHarness();
    const claims = nextClaims();
    const token = signHerdrCoreAttachToken(claims, SIGNING_KEY);

    const first = new WebSocket(
      `${wsBase}${HERDR_CORE_CLIENT_ATTACH_PATH}?token=${encodeURIComponent(token)}`,
    );
    cleanups.push(async () => first.close());
    await new Promise<void>((resolve, reject) => {
      first.once("open", () => resolve());
      first.once("error", reject);
    });

    const replayStatus = await new Promise<number>((resolve, reject) => {
      const second = new WebSocket(
        `${wsBase}${HERDR_CORE_CLIENT_ATTACH_PATH}?token=${encodeURIComponent(token)}`,
      );
      second.once("unexpected-response", (_req, res) =>
        resolve(res.statusCode ?? 0),
      );
      second.once("open", () => {
        second.close();
        reject(new Error("Replayed token should not have upgraded"));
      });
    });
    expect(replayStatus).toBe(409);

    const unknownStatus = await new Promise<number>((resolve, reject) => {
      const unknown = new WebSocket(`${wsBase}/v1/unknown-ws-path`);
      unknown.once("unexpected-response", (_req, res) =>
        resolve(res.statusCode ?? 0),
      );
      unknown.once("open", () => {
        unknown.close();
        reject(new Error("Unknown path should not have upgraded"));
      });
    });
    expect(unknownStatus).toBe(404);
  });

  it("closes active attach sessions cleanly when the Computer control-plane disconnects", async () => {
    const { connection, relay, wsBase, waitForAttachToolCall } =
      await startHarness();
    const claims = nextClaims();
    const token = signHerdrCoreAttachToken(claims, SIGNING_KEY);

    const clientWs = new WebSocket(
      `${wsBase}${HERDR_CORE_CLIENT_ATTACH_PATH}?token=${encodeURIComponent(token)}`,
    );
    cleanups.push(async () => clientWs.close());
    const clientQueue = makeQueue(clientWs);
    await new Promise<void>((resolve, reject) => {
      clientWs.once("open", () => resolve());
      clientWs.once("error", reject);
    });
    await waitForAttachToolCall();
    expect(relay.activeSessionCount()).toBe(1);

    const closedPromise = new Promise<void>((resolve) =>
      clientWs.once("close", () => resolve()),
    );
    connection.disconnect();

    const closedFrame = await clientQueue.next();
    expect(JSON.parse(closedFrame.data.toString("utf8"))).toEqual({
      type: "closed",
      reason: "computer_disconnected",
    });
    await closedPromise;
    await vi.waitFor(() => expect(relay.activeSessionCount()).toBe(0));
  });
});
