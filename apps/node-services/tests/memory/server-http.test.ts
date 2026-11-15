import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MemoryScheduleConfig } from "../../src/memory/config.js";
import { startHttpHost, type HttpHost } from "../../src/http-host.js";
import { MemoryScheduler } from "../../src/memory/scheduler.js";
import { startMemoryServer } from "../../src/memory/server.js";

const schedule: MemoryScheduleConfig = {
  concurrency: 1,
  timeZone: "Asia/Shanghai",
  weeklyDay: 1,
};
const token = "memory-http-token";
const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { force: true, recursive: true })),
  );
});

async function startDataRoot(): Promise<string> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "memory-http-"));
  roots.push(dataRoot);
  return dataRoot;
}

async function start(): Promise<string> {
  const server = await startMemoryServer({
    dataRoot: await startDataRoot(),
    host: "127.0.0.1",
    port: 0,
    scheduler: new MemoryScheduler(schedule, async () => {}),
    serviceToken: token,
  });
  closers.push(() => server.close());
  return server.url;
}

async function startOn(host: HttpHost) {
  const server = await startMemoryServer({
    dataRoot: await startDataRoot(),
    http: host,
    scheduler: new MemoryScheduler(schedule, async () => {}),
    serviceToken: token,
  });
  closers.push(() => server.close());
  return server;
}

const protectedRoutes: Array<[method: string, path: string]> = [
  ["GET", "/internal/v1/memory/entries"],
  ["GET", `/internal/v1/memory/entries/memory_${"a".repeat(24)}`],
  ["POST", "/internal/v1/personal-knowledge-graph-visualization"],
  ["POST", "/internal/v1/published-wiki-graph-updates"],
  ["GET", "/internal/v1/health/failures"],
  ["POST", "/internal/v1/health/failures:retry"],
  ["GET", "/internal/v1/rebuild"],
  ["POST", "/internal/v1/rebuild"],
  ["POST", "/internal/v1/query"],
  ["POST", "/internal/v1/personal-knowledge/evidence"],
];

describe("Memory HTTP surface", () => {
  it("serves unauthenticated health and readiness routes", async () => {
    const url = await start();
    for (const route of ["/healthz", "/readyz"]) {
      const response = await fetch(`${url}${route}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      await expect(response.text()).resolves.toBe('{"status":"ok"}');
    }
  });

  it("answers unknown paths and unsupported methods with an empty 404", async () => {
    const url = await start();
    for (const [method, route] of [
      ["GET", "/nope"],
      ["GET", "/runs"],
      ["GET", "/runs/view"],
      ["PUT", "/internal/v1/query"],
      ["GET", "/internal/v1/query"],
      ["POST", "/internal/v1/flashback:suggest"],
      ["DELETE", "/internal/v1/rebuild"],
      ["POST", "/internal/v1/memory/entries"],
      ["GET", "/internal/v1/memory/entries/not-an-entry"],
    ] as const) {
      const response = await fetch(`${url}${route}`, {
        headers: { authorization: `Bearer ${token}` },
        method,
      });
      expect(`${method} ${route} ${response.status}`).toBe(
        `${method} ${route} 404`,
      );
      await expect(response.text()).resolves.toBe("");
    }
  });

  it("rejects missing, malformed and wrong credentials on every protected route", async () => {
    const url = await start();
    for (const [method, route] of protectedRoutes) {
      for (const headers of [
        undefined,
        { authorization: "Bearer wrong" },
        { authorization: `Bearer ${token}x` },
        { authorization: token },
      ]) {
        const response = await fetch(`${url}${route}`, {
          body: method === "POST" ? "{}" : undefined,
          headers,
          method,
        });
        expect(`${method} ${route} ${response.status}`).toBe(
          `${method} ${route} 401`,
        );
        expect(response.headers.get("content-type")).toBe("application/json");
        await expect(response.text()).resolves.toBe(
          '{"error":{"code":"unauthenticated","message":"Unauthorized"}}',
        );
      }
    }
  });

  it("reports invalid JSON and oversized bodies as invalid requests", async () => {
    const url = await start();
    for (const [method, route] of protectedRoutes) {
      // Without a published Wiki consumer this route fails before reading the body.
      if (method !== "POST" || route.endsWith("published-wiki-graph-updates"))
        continue;
      for (const [body, message] of [
        ["{", /JSON/u],
        [`{"x":"${"a".repeat(17_000)}"}`, /^Request body is too large$/u],
      ] as const) {
        const response = await fetch(`${url}${route}`, {
          body,
          headers: { authorization: `Bearer ${token}` },
          method,
        });
        expect(`${method} ${route} ${response.status}`).toBe(
          `${method} ${route} 400`,
        );
        const payload = (await response.json()) as {
          error: { code: string; message: string };
        };
        expect(payload.error.code).toBe("invalid_request");
        expect(payload.error.message).toMatch(message);
      }
    }
  });

  it("reports an unconfigured Wiki index as unavailable", async () => {
    const url = await start();
    const response = await fetch(
      `${url}/internal/v1/published-wiki-graph-updates`,
      {
        body: "{",
        headers: { authorization: `Bearer ${token}` },
        method: "POST",
      },
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "wiki_index_unavailable",
        message: "Wiki index unavailable",
      },
    });
  });

  it("serves failure health for an authenticated caller", async () => {
    const url = await start();
    const response = await fetch(`${url}/internal/v1/health/failures`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});

describe("Memory HTTP surface on a shared host", () => {
  it("unmounts its routes on close and leaves the host running", async () => {
    const host = await startHttpHost({ host: "127.0.0.1", port: 0 });
    closers.push(() => host.close());
    host.mount({
      prefixes: ["/v1/"],
      fetch: () => new Response("agent"),
    });
    host.finishStartup();
    const headers = { authorization: `Bearer ${token}` };
    const memoryRoute = `${host.url}/internal/v1/health/failures`;
    const server = await startOn(host);

    const ready = await fetch(`${host.url}/readyz`);
    expect(ready.status).toBe(200);
    expect((await fetch(memoryRoute, { headers })).status).toBe(200);

    await server.close();

    const gone = await fetch(memoryRoute, { headers });
    expect(gone.status).toBe(404);
    await expect(gone.text()).resolves.toBe("");
    expect((await fetch(`${host.url}/v1/models`)).status).toBe(200);
    expect((await fetch(`${host.url}/healthz`)).status).toBe(200);
    await expect(server.close()).resolves.toBeUndefined();

    const replacement = await startOn(host);
    expect(replacement.url).toBe(host.url);
    expect((await fetch(memoryRoute, { headers })).status).toBe(200);
  });
});
