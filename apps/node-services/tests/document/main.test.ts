import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import type { JsonLogger } from "@linger/service-kit/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startDocumentService } from "../../src/document/main.js";

const environment = {
  LINGER_SECRET_SEED: "test-seed-0123456789abcdef0123456789",
  // Nothing listens here. The body store connects on its first statement, and
  // these tests open no Document.
  TEAMHUB_DATABASE_URL: "postgres://teamhub@127.0.0.1:9/teamhub",
};
const savedEnvironment = new Map<string, string | undefined>();
const temporaryHomes: string[] = [];

async function setTestEnvironment(
  values: Record<string, string>,
): Promise<void> {
  const agentHome = await mkdtemp(path.join(tmpdir(), "document-role-home-"));
  temporaryHomes.push(agentHome);
  for (const [name, value] of Object.entries({
    AGENT_HOME: agentHome,
    ...values,
  })) {
    if (!savedEnvironment.has(name))
      savedEnvironment.set(name, process.env[name]);
    process.env[name] = value;
  }
}

afterEach(async () => {
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnvironment.clear();
  await Promise.all(
    temporaryHomes
      .splice(0)
      .map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

function testLogger() {
  const log = vi.fn<JsonLogger["log"]>();
  const logger: JsonLogger = { log, child: () => logger };
  return { logger, log };
}

// The Document Runtime binds its configured host, so the blocker holds that
// exact address: macOS lets a specific bind share a port with a wildcard one.
async function occupyPort(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

describe("Document role", () => {
  it("serves from its own thread without leaking DOM globals into the host", async () => {
    const port = await freePort();
    await setTestEnvironment({
      ...environment,
      DOCUMENT_RUNTIME_HTTP_ADDRESS: `127.0.0.1:${port}`,
    });

    const role = await startDocumentService(testLogger());
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(response.status).toBe(200);
      expect("window" in globalThis).toBe(false);
      expect("document" in globalThis).toBe(false);
    } finally {
      await role.stop();
    }
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });

  it("fails startup with the thread's configuration error", async () => {
    await setTestEnvironment({
      ...environment,
      DOCUMENT_RUNTIME_HTTP_ADDRESS: "127.0.0.1:0",
    });

    await expect(startDocumentService(testLogger())).rejects.toThrow(
      "DOCUMENT_RUNTIME_HTTP_ADDRESS must be host:port with a port between 1 and 65535",
    );
  });

  // Two real worker startups and teardown surround the bounded 10s wait. A
  // short first restart delay keeps the wait on the rebuild, not the backoff.
  it("starts without the thread while its port is busy and serves once the port frees", async () => {
    const blocker = createServer();
    const port = await occupyPort(blocker);
    await setTestEnvironment({
      ...environment,
      DOCUMENT_RUNTIME_HTTP_ADDRESS: `127.0.0.1:${port}`,
    });
    const { logger, log } = testLogger();

    const role = await startDocumentService({
      logger,
      firstRestartDelayMs: 50,
    });
    try {
      expect(log).toHaveBeenCalledWith(
        "error",
        "document.thread_failed",
        expect.objectContaining({ restart_in_ms: 50 }),
      );
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      await vi.waitFor(
        async () => {
          const response = await fetch(`http://127.0.0.1:${port}/healthz`);
          expect(response.status).toBe(200);
        },
        { timeout: 10_000, interval: 20 },
      );
    } finally {
      blocker.close();
      await role.stop();
    }
  }, 15_000);

  it("rebuilds a thread that exits after startup and drains the new one", async () => {
    const threads: Worker[] = [];
    const { logger, log } = testLogger();
    const role = await startDocumentService({
      logger,
      createThread: () => {
        const thread = new Worker(
          new URL("./fixtures/document-thread-stub.mjs", import.meta.url),
        );
        threads.push(thread);
        return thread;
      },
    });
    let rebuiltExit: Promise<number> | undefined;
    try {
      expect(threads).toHaveLength(1);
      await threads[0]!.terminate();
      await vi.waitFor(() => expect(threads).toHaveLength(2), {
        timeout: 5_000,
        interval: 50,
      });
      expect(log).toHaveBeenCalledWith(
        "error",
        "document.thread_failed",
        expect.objectContaining({ restart_in_ms: 1_000 }),
      );
      rebuiltExit = new Promise((resolve) => threads[1]!.once("exit", resolve));
    } finally {
      // Resolves only after the rebuilt thread answers the drain.
      await role.stop();
    }
    await expect(rebuiltExit).resolves.toEqual(expect.any(Number));
    expect(threads).toHaveLength(2);
  });

  it("terminates a wedged thread when its drain reply times out", async () => {
    const threads: Worker[] = [];
    const role = await startDocumentService({
      logger: testLogger().logger,
      drainTimeoutMs: 50,
      createThread: () => {
        const thread = new Worker(
          'const { parentPort } = require("node:worker_threads"); parentPort.on("message", () => {}); parentPort.postMessage("listening");',
          { eval: true },
        );
        threads.push(thread);
        return thread;
      },
    });
    const exited = new Promise((resolve) => threads[0]!.once("exit", resolve));
    await expect(role.stop()).rejects.toThrow(
      "Document Runtime thread timed out during drain",
    );
    await expect(exited).resolves.toEqual(expect.any(Number));
  });
});
