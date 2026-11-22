import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalComputerRouteHandlers,
  LocalComputerHttpError,
  registerLocalComputerModelSourceRoutes,
} from "../../../../src/agent/executor/http/local-computer-http.js";
import {
  LocalComputerOfflineError,
  LocalModelSourceError,
  type LocalComputerManagement,
  type LocalModelSourceCommand,
} from "../../../../src/agent/runner-gateway/local-computer-management.js";

const secretKey = "sk-top-secret-never-echo-or-log";
const basePath =
  "/v1/tenants/tenant-1/owners/actor-1/local-computers/computer-1/model-source";

const sampleStatus = {
  mode: "byok",
  runtime: "claude",
  runtime_model: "localmodels-byok",
  gateway_url: "http://127.0.0.1:43120",
  byok: {
    configured: true,
    protocol: "anthropic",
    base_url: "https://api.anthropic.com",
    path: "/v1",
    endpoint: "/messages",
    model_id: "claude-sonnet-4-6",
    context_window: 200_000,
    key_saved: true,
  },
} as const;

function buildTestApp(
  modelSource: (command: LocalModelSourceCommand) => Promise<{
    readonly status?: typeof sampleStatus;
    readonly testResult?: {
      readonly ok: boolean;
      readonly protocol: "anthropic";
      readonly url: string;
      readonly model_id: string;
      readonly context_window: number;
    };
    readonly modelList?: {
      readonly url: string;
      readonly models: readonly {
        readonly id: string;
        readonly name?: string;
        readonly context_window?: number;
      }[];
    };
  }>,
) {
  const handlers = createLocalComputerRouteHandlers({
    localComputerManagement: {
      modelSource,
    } as unknown as LocalComputerManagement,
    pathId: (context, name) => context.req.param(name) ?? "",
    readJsonBody: (context) => context.req.json(),
  });
  const app = new Hono();
  registerLocalComputerModelSourceRoutes(app, handlers);
  app.onError((error, context) =>
    error instanceof LocalComputerHttpError
      ? context.json(
          { code: error.errorCode, message: error.message },
          error.status,
        )
      : context.json({ code: "internal" }, 500),
  );
  return app;
}

describe("Agent Management model-source routes", () => {
  it("reads model-source status and returns redacted BYOK summary", async () => {
    const fn = vi.fn(async () => ({ status: sampleStatus }));
    const res = await buildTestApp(fn).request(basePath);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sampleStatus);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerActorId: "actor-1",
        computerId: "computer-1",
        action: "status",
      }),
    );
  });

  it("forwards BYOK test and apply without echoing the API key", async () => {
    const fn = vi.fn(async (cmd: LocalModelSourceCommand) =>
      cmd.action === "test"
        ? {
            testResult: {
              ok: true,
              protocol: "anthropic" as const,
              url: "https://api.anthropic.com/v1/messages",
              model_id: "claude-sonnet-4-6",
              context_window: 200_000,
            },
          }
        : { status: sampleStatus },
    );
    const app = buildTestApp(fn);

    const testRes = await app.request(`${basePath}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        byok: {
          base_url: "https://api.anthropic.com",
          path: "/v1",
          endpoint: "/messages",
          protocol: "anthropic",
          api_key: secretKey,
          model_id: "claude-sonnet-4-6",
        },
      }),
    });
    expect(testRes.status).toBe(200);
    const testText = await testRes.text();
    expect(testText).not.toContain(secretKey);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "test",
        byok: expect.objectContaining({
          path: "/v1",
          endpoint: "/messages",
          protocol: "anthropic",
        }),
      }),
    );
    expect(fn.mock.calls[0]?.[0]).not.toHaveProperty("runtime");

    const applyRes = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "byok",
        runtime: "claude",
        byok: {
          base_url: "https://api.anthropic.com",
          path: "/v1",
          endpoint: "/messages",
          protocol: "anthropic",
          api_key: secretKey,
          model_id: "claude-sonnet-4-6",
        },
      }),
    });
    expect(applyRes.status).toBe(200);
    expect(await applyRes.text()).not.toContain(secretKey);
  });

  it("lists a BYOK endpoint's models from the address and key alone", async () => {
    const modelList = {
      url: "https://open.bigmodel.cn/api/paas/v4/models",
      models: [{ id: "glm-5", name: "GLM 5", context_window: 131_072 }],
    };
    const fn = vi.fn(async () => ({ modelList }));
    const app = buildTestApp(fn);

    const res = await app.request(`${basePath}/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        base_url: " https://open.bigmodel.cn ",
        path: "/api/paas/v4",
        endpoint: "/chat/completions",
        protocol: "openai-chat",
        api_key: secretKey,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(secretKey);
    expect(JSON.parse(text)).toEqual(modelList);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "models",
        byok: {
          base_url: "https://open.bigmodel.cn",
          path: "/api/paas/v4",
          endpoint: "/chat/completions",
          protocol: "openai-chat",
          api_key: secretKey,
        },
      }),
    );

    const withModel = await app.request(`${basePath}/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        base_url: "https://open.bigmodel.cn",
        path: "/api/paas/v4",
        endpoint: "/chat/completions",
        protocol: "openai-chat",
        model_id: "glm-5",
      }),
    });
    expect(withModel.status).toBe(400);

    for (const address of [
      { path: "api/paas/v4", endpoint: "/chat/completions" },
      { path: "/api/paas/v4/", endpoint: "/chat/completions" },
      { path: "", endpoint: "//evil.example.com/x" },
      { path: "", endpoint: "/chat?key=1" },
    ]) {
      const refused = await app.request(`${basePath}/models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          base_url: "https://open.bigmodel.cn",
          protocol: "openai-chat",
          ...address,
        }),
      });
      expect(refused.status).toBe(400);
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("maps invalid input, offline computer, and upstream rejection without leaking secrets", async () => {
    const fn = vi.fn(async () => {
      throw new LocalModelSourceError(
        "BYOK_UPSTREAM_REJECTED",
        "Upstream endpoint returned HTTP 401.",
        false,
      );
    });
    const app = buildTestApp(fn);

    const badRes = await app.request(`${basePath}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        byok: {
          base_url: "https://api.example.com",
          path: "/v1",
          endpoint: "/chat/completions",
          protocol: "gemini",
          api_key: secretKey,
          model_id: "gpt-5.4",
        },
      }),
    });
    expect(badRes.status).toBe(400);
    expect(await badRes.text()).not.toContain(secretKey);
    expect(fn).not.toHaveBeenCalled();

    const upstreamRes = await app.request(`${basePath}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        byok: {
          base_url: "https://api.anthropic.com",
          path: "/v1",
          endpoint: "/messages",
          protocol: "anthropic",
          api_key: secretKey,
          model_id: "claude-sonnet-4-6",
        },
      }),
    });
    expect(upstreamRes.status).toBe(502);
    expect(await upstreamRes.json()).toEqual({
      code: "BYOK_UPSTREAM_REJECTED",
      message: "Upstream endpoint returned HTTP 401.",
    });

    const offlineApp = buildTestApp(async () => {
      throw new LocalComputerOfflineError();
    });
    expect((await offlineApp.request(basePath)).status).toBe(503);
  });

  it("maps MODEL_SOURCE_UNSUPPORTED from localmodels to HTTP 409", async () => {
    const app = buildTestApp(async () => {
      throw new LocalModelSourceError(
        "MODEL_SOURCE_UNSUPPORTED",
        "The localmodels tool on this Computer does not support model sources.",
        false,
      );
    });

    const getRes = await app.request(basePath);
    expect(getRes.status).toBe(409);
    expect(await getRes.json()).toEqual({
      code: "MODEL_SOURCE_UNSUPPORTED",
      message:
        "The localmodels tool on this Computer does not support model sources.",
    });

    const postRes = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "subscription", runtime: "claude" }),
    });
    expect(postRes.status).toBe(409);
    expect(await postRes.json()).toEqual({
      code: "MODEL_SOURCE_UNSUPPORTED",
      message:
        "The localmodels tool on this Computer does not support model sources.",
    });
  });

  it("preserves BYOK_GATEWAY_FAILED and Computer diagnostic detail as HTTP 502", async () => {
    const detail =
      "cannot record Bifrost process identity ([Errno 1] Operation not permitted: '/bin/ps'); stopped it";
    const app = buildTestApp(async () => {
      throw new LocalModelSourceError("BYOK_GATEWAY_FAILED", detail, false);
    });

    const postRes = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "byok",
        runtime: "pi",
        byok: {
          base_url: "https://api.kimi.com/coding",
          path: "/v1",
          endpoint: "/chat/completions",
          protocol: "openai-chat",
          api_key: secretKey,
          model_id: "k3",
        },
      }),
    });
    expect(postRes.status).toBe(502);
    expect(await postRes.json()).toEqual({
      code: "BYOK_GATEWAY_FAILED",
      message: detail,
    });
  });
});
