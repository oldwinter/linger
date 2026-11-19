import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkByokEndpoint,
  isAllowedByokUrl,
  prepareByokRuntime,
  applyNativeSource,
  readByokEnvironment,
  validateByokConfiguration,
} from "./byok-source.js";
import { atomicPrivate, privateDirectory } from "./instance.js";

const tempDirs: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "linger-byok-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("isAllowedByokUrl", () => {
  it("allows HTTPS and private LAN/loopback HTTP endpoints", () => {
    expect(isAllowedByokUrl("https://api.openai.com/v1/")).toBe(true);
    expect(isAllowedByokUrl("http://127.0.0.1:8000/v1")).toBe(true);
    expect(isAllowedByokUrl("http://192.168.10.117:8080/v1")).toBe(true);
    expect(isAllowedByokUrl("http://100.88.1.5:11434/v1")).toBe(true);
    expect(
      validateByokConfiguration({
        baseUrl: "https://api.openai.com/v1/",
        modelId: "gpt-5.4",
      }).baseUrl,
    ).toBe("https://api.openai.com/v1");
  });

  it("blocks link-local metadata, public HTTP, and URL credentials", () => {
    expect(isAllowedByokUrl("http://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(isAllowedByokUrl("https://metadata.google.internal/v1")).toBe(false);
    expect(isAllowedByokUrl("http://api.example.com/v1")).toBe(false);
    expect(isAllowedByokUrl("https://user@api.example.com/v1")).toBe(false);
  });
});

describe("BYOK localmodels integration", () => {
  it("passes BYOK secrets over stdin and never in argv", async () => {
    const home = await makeHome();
    const calls: { args: string[]; input?: string }[] = [];
    const fakeLocalmodels = vi.fn(
      async (
        _home: string,
        args: string[],
        options: { input?: string } = {},
      ) => {
        calls.push({ args, input: options.input });
        return {
          code: 0,
          stdout: JSON.stringify({
            ok: true,
            protocol: "openai-responses",
            base_url: "https://api.example.com/v1",
            model_id: "gpt-5.4",
            context_window: 200_000,
          }),
          stderr: "",
        };
      },
    );
    const report = await checkByokEndpoint(
      home,
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-private-secret",
        modelId: "gpt-5.4",
        runtime: "codex",
      },
      new AbortController().signal,
      { localmodels: fakeLocalmodels },
    );
    expect(report).toEqual({
      ok: true,
      protocol: "openai-responses",
      baseUrl: "https://api.example.com/v1",
      modelId: "gpt-5.4",
      contextWindow: 200_000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.join(" ")).not.toContain("sk-private-secret");
    expect(calls[0]!.args).toContain("--config-stdin");
    expect(calls[0]!.args.join(" ")).toContain("--runtime codex");
    expect(JSON.parse(calls[0]!.input!)).toMatchObject({
      apiKey: "sk-private-secret",
      modelId: "gpt-5.4",
    });
  });

  it("mounts BYOK on Bifrost even when native runtime lacks vendor OAuth", async () => {
    const home = await makeHome();
    const outcome = await prepareByokRuntime(
      {
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
        modelId: "claude-sonnet-4-6",
        runtime: "claude",
      },
      {
        home,
        signal: new AbortController().signal,
        onEvent: () => {},
      },
      {
        prepareNative: async () => ({
          code: 1,
          state: "waiting_user",
          message: "Login required",
          details: { code: "RUNTIME_AUTH_REQUIRED" },
        }),
        localmodels: async () => ({
          code: 0,
          stdout: JSON.stringify({ ok: true }),
          stderr: "",
        }),
      },
    );
    expect(outcome.code).toBe(0);
    expect(outcome.state).toBe("ready");
  });

  it("sets a subscription source through localmodels, never writing it itself", async () => {
    const home = await makeHome();
    const calls: string[][] = [];
    const outcome = await applyNativeSource(
      home,
      "subscription",
      "codex",
      new AbortController().signal,
      {
        localmodels: async (_home, args) => {
          calls.push(args);
          return { code: 0, stdout: "{}", stderr: "" };
        },
      },
    );
    expect(outcome).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 6)).toEqual([
      "source",
      "apply",
      "--mode",
      "subscription",
      "--runtime",
      "codex",
    ]);
    expect(calls[0]).not.toContain("--config-stdin");
    expect(await readByokEnvironment(home)).toBeUndefined();
  });

  it("reports what localmodels refused when setting a source", async () => {
    const outcome = await applyNativeSource(
      await makeHome(),
      "local",
      "pi",
      new AbortController().signal,
      {
        localmodels: async () => ({
          code: 2,
          stdout: JSON.stringify({
            code: "MODEL_UNKNOWN",
            message: "No model is loaded.",
          }),
          stderr: "",
        }),
      },
    );
    expect(outcome).toEqual({
      code: 1,
      state: "failed",
      message: "No model is loaded.",
      details: { code: "MODEL_UNKNOWN" },
    });
  });

  it("reads the runtime environment overrides localmodels recorded", async () => {
    const home = await makeHome();
    const state = path.join(home, "runtime", "localmodels", "state");
    await privateDirectory(state);
    await atomicPrivate(
      path.join(state, "model-source.json"),
      JSON.stringify({
        schema: "localmodels.model-source/v1",
        mode: "byok",
        runtime: "pi",
        runtime_model: "localmodels-byok",
        model_label: "vendor/model",
        gateway_url: "http://127.0.0.1:18480",
        environment: { PI_CODING_AGENT_DIR: "/abs/pi", OTHER: "/ignored" },
      }),
    );
    expect(await readByokEnvironment(home)).toEqual({
      mode: "byok",
      runtime: "pi",
      runtimeModel: "localmodels-byok",
      environment: { PI_CODING_AGENT_DIR: "/abs/pi" },
    });
  });
});
