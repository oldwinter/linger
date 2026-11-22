import { afterEach, describe, expect, it, vi } from "vitest";

const events: string[] = [];
let close: (() => Promise<void>) | undefined;

vi.mock("../src/process-lifecycle.js", () => ({
  SHUTDOWN_TIMEOUT_MS: 1_000,
  runServiceProcess: async (
    start: (control: unknown) => Promise<{ close(): Promise<void> }>,
  ) => {
    const running = await start({
      signal: new AbortController().signal,
      progress: () => undefined,
    });
    close = running.close;
  },
}));

vi.mock("../src/http-host.js", () => ({
  startHttpHost: async () => ({
    url: "http://127.0.0.1:0",
    finishStartup: () => events.push("http:finishStartup"),
    close: async () => undefined,
  }),
}));

vi.mock("../src/model-packages.js", () => ({
  pruneModelPackages: async () => [],
}));

vi.mock("../src/memory/main.js", () => ({
  startMemoryService: async () => {
    events.push("memory:start");
    return {
      flashback: {},
      started: () => events.push("memory:started"),
      stopping: () => events.push("memory:stopping"),
      stop: async () => {
        events.push("memory:stop");
      },
    };
  },
}));

vi.mock("../src/agent/main.js", () => ({
  startAgentService: async () => {
    events.push("agent:start");
    return {
      modelCall: {},
      stop: async () => {
        events.push("agent:stop");
      },
    };
  },
}));

afterEach(() => {
  events.length = 0;
  close = undefined;
  vi.unstubAllEnvs();
});

describe("node-services role lifecycle", () => {
  it("starts background work after every role and stops it before any role", async () => {
    vi.stubEnv("NODE_SERVICES_ROLES", "memory,agent");
    vi.stubEnv("NODE_ENV", "test");
    const { main } = await import("../src/main.js");
    await main();
    // Memory's scheduler needs the agent role's model call, which exists only
    // once the agent role has started.
    expect(events).toEqual([
      "memory:start",
      "agent:start",
      "memory:started",
      "http:finishStartup",
    ]);

    events.length = 0;
    await close?.();
    expect(events).toEqual(["memory:stopping", "agent:stop", "memory:stop"]);
  });
});
