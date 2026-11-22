import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { NODE_RUNTIME_VERSION } from "../../../../scripts/local-computer-node-distributions.mjs";
import { ConfigStore } from "./config.js";
import { LocalServerModule } from "./local-server.js";
import { EventBus, ModuleHost } from "./modules.js";
import { stubModule, tempDirectory } from "./test-support.js";

function setupResumeFixture(installerScript: string) {
  const root = tempDirectory();
  const home = path.join(root, "home");
  const installerDirectory = path.join(root, "installer");
  mkdirSync(installerDirectory, { recursive: true });
  writeFileSync(path.join(installerDirectory, "installer.js"), installerScript);
  writeFileSync(
    path.join(installerDirectory, "package.json"),
    '{"type":"commonjs"}',
  );
  const node = path.join(home, "desktop", "node", `v${NODE_RUNTIME_VERSION}`);
  mkdirSync(path.join(node, "bin"), { recursive: true });
  symlinkSync(process.execPath, path.join(node, "bin", "node"));
  mkdirSync(path.join(home, "desktop"), { recursive: true });
  writeFileSync(
    path.join(home, "desktop", "local-server.json"),
    JSON.stringify({
      home,
      repo: "/source",
      origin: "http://localhost:3000",
    }),
  );

  const logs: Array<{
    level: string;
    event: string;
    fields?: Record<string, unknown>;
  }> = [];
  const setServer = vi.fn(() => true);
  const showStarting = vi.fn();
  const showUpdating = vi.fn();
  const showStartFailed = vi.fn();
  const bus = new EventBus();
  const config = new ConfigStore(path.join(root, "config.json"), {
    serverUrl: "http://localhost:3000",
    computerId: "cmp_1",
  });

  const module = new LocalServerModule({
    home,
    version: "0.16.20",
    installerDirectory,
    platform: "linux",
    arch: "x64",
    pollMs: 10,
    signIn: async () => {},
    fetch: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
  });

  const host = new ModuleHost(
    [
      {
        ...stubModule("WindowManager"),
        setServer,
        showStarting,
        showUpdating,
        showStartFailed,
      } as never,
      stubModule("Enrollment"),
      module,
    ],
    {
      config,
      bus,
      log: {
        info: (event, fields) => logs.push({ level: "info", event, fields }),
        warn: (event, fields) => logs.push({ level: "warn", event, fields }),
        error: (event, fields) => logs.push({ level: "error", event, fields }),
      },
    },
  );

  return {
    home,
    module,
    host,
    logs,
    setServer,
    showStarting,
    showStartFailed,
  };
}

describe("LocalServerModule resume coordination", () => {
  it("passes resume_ready and emits structured stage logs", async () => {
    const f = setupResumeFixture(`
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ code: 0, details: { origin: "http://localhost:3000" } }) + "\\n");
      }, 40);
    `);

    await f.host.start();

    await vi.waitFor(() => expect(f.module.status().phase).toBe("ready"));
    expect(f.showStarting).toHaveBeenCalledOnce();
    expect(f.setServer).toHaveBeenCalledWith(
      "http://localhost:3000",
      "http://localhost:3000",
      { reason: "resume_ready" },
    );

    const events = f.logs.map((entry) => entry.event);
    expect(events).toContain("local_server.resume_started");
    expect(events).toContain("local_server.resume_succeeded");
    const stages = f.logs
      .filter((entry) => entry.event === "local_server.resume_stage")
      .map((entry) => entry.fields?.stage);
    expect(stages).toEqual([
      "fast_ready_check",
      "ensure_node",
      "installer_resume",
    ]);

    const succeeded = f.logs.find(
      (entry) => entry.event === "local_server.resume_succeeded",
    );
    expect(typeof succeeded?.fields?.total_ms).toBe("number");
    await f.host.stop("quit");
  });

  it("logs a BYOK gateway that did not come back and still resumes", async () => {
    const f = setupResumeFixture(`
      process.stdout.write(JSON.stringify({ code: 0, details: { origin: "http://localhost:3000", byokGateway: { code: "BYOK_UNREACHABLE", message: "Endpoint did not answer." } } }) + "\\n");
    `);

    await f.host.start();

    await vi.waitFor(() => expect(f.module.status().phase).toBe("ready"));
    expect(f.showStartFailed).not.toHaveBeenCalled();
    expect(
      f.logs.find(
        (entry) => entry.event === "local_server.byok_gateway_unavailable",
      ),
    ).toEqual({
      level: "warn",
      event: "local_server.byok_gateway_unavailable",
      fields: { code: "BYOK_UNREACHABLE", message: "Endpoint did not answer." },
    });
    await f.host.stop("quit");
  });

  it("redacts query, hash, and secrets and bounds resume_failed errors to 500 chars", async () => {
    const longPadding = "x".repeat(600);
    const f = setupResumeFixture(`
      process.stdout.write(JSON.stringify({
        code: 1,
        message: "Failed at https://linger.example.com/auth?token=secret123#frag with Bearer super-secret-token-123 ${longPadding}"
      }) + "\\n");
    `);

    await f.host.start();
    await vi.waitFor(() => expect(f.module.status().phase).toBe("failed"));

    const failed = f.logs.find(
      (entry) => entry.event === "local_server.resume_failed",
    );
    expect(failed).toBeDefined();
    expect(failed?.fields?.stage).toBe("installer_resume");
    expect(typeof failed?.fields?.total_ms).toBe("number");
    const errorText = String(failed?.fields?.error ?? "");
    expect(errorText.length).toBeLessThanOrEqual(500);
    expect(errorText).not.toContain("token=secret123");
    expect(errorText).not.toContain("#frag");
    expect(errorText).not.toContain("super-secret-token-123");
    await f.host.stop("quit");
  });

  it("reports resumable() true for the resuming origin only, true for a valid matching record, and false for malformed or incomplete records", async () => {
    const f = setupResumeFixture(`
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ code: 0, details: { origin: "http://localhost:3000" } }) + "\\n");
      }, 60);
    `);

    await f.host.start();
    // An active resume vouches only for the origin it resumes, not for a
    // remote server the user switched to meanwhile.
    await expect(f.module.resumable("http://localhost:3000")).resolves.toBe(
      true,
    );
    await expect(f.module.resumable("http://localhost:9999")).resolves.toBe(
      false,
    );

    await vi.waitFor(() => expect(f.module.status().phase).toBe("ready"));
    await expect(
      f.module.resumable("http://localhost:3000/rooms/1"),
    ).resolves.toBe(true);
    await expect(f.module.resumable("http://localhost:3001")).resolves.toBe(
      false,
    );

    const recordFile = path.join(f.home, "desktop", "local-server.json");
    writeFileSync(recordFile, "{not json");
    await expect(f.module.resumable("http://localhost:3000")).resolves.toBe(
      false,
    );

    writeFileSync(
      recordFile,
      JSON.stringify({ home: f.home, origin: "http://localhost:3000" }),
    );
    await expect(f.module.resumable("http://localhost:3000")).resolves.toBe(
      false,
    );
    await f.host.stop("quit");
  });
});
