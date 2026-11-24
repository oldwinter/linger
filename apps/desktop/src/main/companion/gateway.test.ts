import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import tls from "node:tls";

import { afterEach, describe, expect, it } from "vitest";

import { silentLog, tempDirectory } from "../test-support.js";
import { CompanionGateway } from "./gateway.js";
import { PairingManager, ensureHostId } from "./pairing.js";
import { computeSpkiFingerprint, ensureTlsMaterial } from "./tls.js";

interface HttpResponse {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  readonly tlsProtocol?: string | null;
  readonly peerSpkiFingerprint?: string;
}

function requestRaw(options: {
  readonly tls: boolean;
  readonly port: number;
  readonly method?: string;
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: "127.0.0.1",
      port: options.port,
      method: options.method ?? "GET",
      path: options.path,
      headers: options.headers ?? {},
    };
    const req = options.tls
      ? https.request({ ...reqOptions, rejectUnauthorized: false })
      : http.request(reqOptions);

    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      let tlsProtocol: string | null | undefined;
      let peerSpkiFingerprint: string | undefined;
      if (options.tls && res.socket instanceof tls.TLSSocket) {
        tlsProtocol = res.socket.getProtocol();
        const peerCert = res.socket.getPeerX509Certificate();
        if (peerCert) {
          peerSpkiFingerprint = computeSpkiFingerprint(peerCert);
        }
      }
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          tlsProtocol,
          peerSpkiFingerprint,
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function startUpstreamServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  onUpgrade?: (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => void,
): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const server = http.createServer(handler);
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  if (onUpgrade) server.on("upgrade", onUpgrade);
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        for (const s of sockets) {
          if (!s.destroyed) s.destroy();
        }
        sockets.clear();
      }),
  };
}

describe("CompanionGateway end-to-end", () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const stop of cleanups.splice(0).reverse()) {
      await stop();
    }
  });

  async function createHarness(
    options: {
      readonly tls?: boolean;
      readonly teamhubHandler?: (
        req: IncomingMessage,
        res: ServerResponse,
      ) => void;
      readonly docUpgrade?: (
        req: IncomingMessage,
        socket: import("node:stream").Duplex,
        head: Buffer,
      ) => void;
      readonly customHost?: string;
      readonly pairRateLimitMax?: number;
      readonly pairRateLimitWindowMs?: number;
    } = {},
  ) {
    const useTls = options.tls ?? true;
    const dir = path.join(tempDirectory(), "companion");
    const hostId = ensureHostId(dir);
    const tlsMaterial = useTls ? ensureTlsMaterial(dir) : undefined;

    const teamhub = await startUpstreamServer(
      options.teamhubHandler ??
        ((req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              path: req.url,
              cookie: req.headers.cookie ?? null,
              authorization: req.headers.authorization ?? null,
            }),
          );
        }),
    );
    cleanups.push(teamhub.close);

    const docRuntime = await startUpstreamServer((_req, res) => {
      res.writeHead(426);
      res.end();
    }, options.docUpgrade);
    cleanups.push(docRuntime.close);

    const gatewayRef: { current?: CompanionGateway } = {};
    const pairing = new PairingManager({
      directory: dir,
      hostId,
      getHostName: () => "Test Mac",
      getTlsFingerprint: () => tlsMaterial?.fingerprint ?? "",
      getTenantId: () => "tenant_1",
      mintDeviceSession: async () => ({
        sessionCookie: "initial_session_cookie",
        sessionMode: "dedicated",
        tenantId: "tenant_1",
      }),
      onDeviceRevoked: (id) => gatewayRef.current?.revokeDeviceConnections(id),
      log: silentLog,
    });

    const gateway = new CompanionGateway({
      bindHost: "127.0.0.1",
      port: 0,
      tls: useTls,
      ...(tlsMaterial ? { tlsMaterial } : {}),
      pairing,
      hostId,
      getHostName: () => "Test Mac",
      desktopVersion: "0.16.20",
      ...(options.customHost ? { customHost: options.customHost } : {}),
      hostname: "test-mac.local",
      getAddresses: () => ({
        lan: ["192.168.1.25"],
        tailscale: ["100.64.0.9"],
        allIps: ["127.0.0.1", "::1", "192.168.1.25", "100.64.0.9"],
      }),
      getTeamHubBaseUrl: () => teamhub.url,
      getDocumentRuntimeUrl: () => docRuntime.url,
      getStatusSnapshot: () => ({
        computer_id: "comp_1",
        daemon_connection: "online",
        runtime_state: "ready",
        active_operations: 2,
        prevent_sleep: true,
        local_server_phase: "ready",
        local_models_degraded: false,
        server_url_mode: "local",
      }),
      ...(options.pairRateLimitMax !== undefined
        ? { pairRateLimitMax: options.pairRateLimitMax }
        : {}),
      ...(options.pairRateLimitWindowMs !== undefined
        ? { pairRateLimitWindowMs: options.pairRateLimitWindowMs }
        : {}),
      log: silentLog,
    });
    gatewayRef.current = gateway;
    const port = await gateway.start();
    cleanups.push(() => gateway.stop());

    return { gateway, pairing, port, hostId, tlsMaterial, useTls };
  }

  async function pairOne(h: Awaited<ReturnType<typeof createHarness>>) {
    const win = h.pairing.openPairingWindow();
    const res = await requestRaw({
      tls: h.useTls,
      port: h.port,
      method: "POST",
      path: "/companion/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: win.pair_secret,
        device_name: "Test Phone",
        platform: "ios",
        app_version: "1.2.3",
      }),
    });
    expect(res.status).toBe(200);
    return JSON.parse(res.body) as { device_id: string; token: string };
  }

  it("serves HTTPS over TLS 1.3 with deterministic SPKI fingerprint and supports HTTP opt-in", async () => {
    const h = await createHarness({ tls: true });
    const info = await requestRaw({
      tls: true,
      port: h.port,
      path: "/companion/v1/info",
    });

    expect(info.status).toBe(200);
    expect(info.tlsProtocol).toBe("TLSv1.3");
    expect(info.peerSpkiFingerprint).toBe(h.tlsMaterial!.fingerprint);
    expect(JSON.parse(info.body)).toEqual({
      protocol_version: 1,
      host_id: h.hostId,
      host_name: "Test Mac",
      desktop_version: "0.16.20",
      pairing_open: false,
      tls: true,
      tls_fingerprint: h.tlsMaterial!.fingerprint,
      addresses: { lan: ["192.168.1.25"], tailscale: ["100.64.0.9"] },
    });

    const plain = await createHarness({ tls: false });
    const plainInfo = await requestRaw({
      tls: false,
      port: plain.port,
      path: "/companion/v1/info",
    });
    expect(plainInfo.status).toBe(200);
    expect(JSON.parse(plainInfo.body)).toMatchObject({
      tls: false,
      tls_fingerprint: "",
    });
  });

  it("enforces Origin, Sec-Fetch-Site, Host DNS rebinding, unexposed routes, and forbidden /v0/* paths", async () => {
    const h = await createHarness({
      tls: false,
      customHost: "companion.home.arpa",
    });
    const paired = await pairOne(h);

    // Browser Origin rejected.
    const withOrigin = await requestRaw({
      tls: false,
      port: h.port,
      path: "/companion/v1/info",
      headers: { origin: "https://evil.example" },
    });
    expect(withOrigin.status).toBe(403);

    // Sec-Fetch-Site: cross-site rejected.
    const crossSite = await requestRaw({
      tls: false,
      port: h.port,
      path: "/companion/v1/info",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);

    // Unexpected Host header rejected (DNS rebinding defense).
    const badHost = await requestRaw({
      tls: false,
      port: h.port,
      path: "/companion/v1/info",
      headers: { host: `rebind.attacker.evil:${h.port}` },
    });
    expect(badHost.status).toBe(403);

    // Allowed hosts: LAN IP, discovered Tailscale IP, matching machine Tailscale MagicDNS, local hostname, customHost.
    for (const host of [
      `192.168.1.25:${h.port}`,
      `100.64.0.9:${h.port}`,
      `test-mac.tail1234.ts.net:${h.port}`,
      `test-mac.local:${h.port}`,
      `companion.home.arpa:${h.port}`,
    ]) {
      const ok = await requestRaw({
        tls: false,
        port: h.port,
        path: "/companion/v1/info",
        headers: { host },
      });
      expect(ok.status, `host ${host} should be allowed`).toBe(200);
    }

    // Unowned CGNAT/Tailscale IPs and unrelated *.ts.net hosts are rejected (DNS rebinding hardening).
    for (const rejectedHost of [
      `100.64.99.99:${h.port}`,
      `[fd7a:115c:a1e0::99]:${h.port}`,
      `other-box.tail1234.ts.net:${h.port}`,
      `evil.ts.net:${h.port}`,
    ]) {
      const denied = await requestRaw({
        tls: false,
        port: h.port,
        path: "/companion/v1/info",
        headers: { host: rejectedHost },
      });
      expect(denied.status, `host ${rejectedHost} must be rejected`).toBe(403);
    }

    // Unexposed routes return 404.
    for (const unexposed of [
      "/",
      "/install/computer",
      "/v1/runner-gateway",
      "/api/agent/tasks",
      "/internal/health",
    ]) {
      const res = await requestRaw({
        tls: false,
        port: h.port,
        path: unexposed,
        headers: { authorization: `Bearer ${paired.token}` },
      });
      expect(res.status, `path ${unexposed} must return 404`).toBe(404);
    }

    // Forbidden /v0/* paths return 403.
    for (const forbidden of [
      "/v0/local/identity",
      "/v0/auth/login",
      "/v0/auth/logout",
      "/v0/account/password",
      "/v0/local-computer-enrollments/enr_1/exchange",
      "/v0/tenants/t1/local-computer-enrollments",
    ]) {
      const res = await requestRaw({
        tls: false,
        port: h.port,
        method: "POST",
        path: forbidden,
        headers: { authorization: `Bearer ${paired.token}` },
      });
      expect(res.status, `path ${forbidden} must return 403`).toBe(403);
    }

    // Traversal attempts are rejected before proxying.
    const traversal = await requestRaw({
      tls: false,
      port: h.port,
      path: "/v0/rooms/../auth/login",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(traversal.status).toBe(400);
  });

  it("rate limits pairing attempts per IP and serves status, rotate, and unpair", async () => {
    const h = await createHarness({ tls: false, pairRateLimitMax: 3 });
    h.pairing.openPairingWindow();

    for (let i = 0; i < 3; i += 1) {
      const res = await requestRaw({
        tls: false,
        port: h.port,
        method: "POST",
        path: "/companion/v1/pair",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pin: "000001",
          device_name: "Phone",
          platform: "ios",
        }),
      });
      expect(res.status).toBe(401);
    }
    const limited = await requestRaw({
      tls: false,
      port: h.port,
      method: "POST",
      path: "/companion/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pin: "000001",
        device_name: "Phone",
        platform: "ios",
      }),
    });
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body)).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });

    // Fresh harness for status, rotate, unpair.
    const h2 = await createHarness({ tls: false });
    const paired = await pairOne(h2);

    const status = await requestRaw({
      tls: false,
      port: h2.port,
      path: "/companion/v1/status",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body)).toEqual({
      host_id: h2.hostId,
      host_name: "Test Mac",
      desktop_version: "0.16.20",
      computer_id: "comp_1",
      daemon_connection: "online",
      runtime_state: "ready",
      active_operations: 2,
      prevent_sleep: true,
      local_server_phase: "ready",
      local_models_degraded: false,
      server_url_mode: "local",
      device_id: paired.device_id,
      paired_devices_count: 1,
    });

    const rotated = await requestRaw({
      tls: false,
      port: h2.port,
      method: "POST",
      path: "/companion/v1/token/rotate",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(rotated.status).toBe(200);
    const { token: newToken } = JSON.parse(rotated.body) as { token: string };
    expect(newToken).not.toBe(paired.token);

    // Old token no longer works.
    const oldStatus = await requestRaw({
      tls: false,
      port: h2.port,
      path: "/companion/v1/status",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(oldStatus.status).toBe(401);

    // Unpair revokes the device cleanly.
    const unpair = await requestRaw({
      tls: false,
      port: h2.port,
      method: "POST",
      path: "/companion/v1/unpair",
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(unpair.status).toBe(200);
    expect(JSON.parse(unpair.body)).toEqual({ unpaired: true });

    const afterUnpair = await requestRaw({
      tls: false,
      port: h2.port,
      path: "/companion/v1/status",
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(afterUnpair.status).toBe(401);
  });

  it("proxies /v0/* with cookie injection, strips Set-Cookie, and captures POST /v0/session cookie refresh", async () => {
    const seenCookies: string[] = [];
    const h = await createHarness({
      tls: false,
      teamhubHandler: (req, res) => {
        seenCookies.push(req.headers.cookie ?? "");
        expect(req.headers.authorization).toBeUndefined();
        if (req.method === "POST" && req.url === "/v0/session") {
          res.writeHead(200, {
            "content-type": "application/json",
            "set-cookie":
              "teamhub_session=rotated_session_42; Path=/; HttpOnly; SameSite=Lax",
          });
          res.end(JSON.stringify({ renewed: true }));
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "teamhub_session=should_not_leak; Path=/; HttpOnly",
        });
        res.end(JSON.stringify({ ok: true }));
      },
    });
    const paired = await pairOne(h);

    // Client-supplied Cookie is stripped and replaced with the device's session cookie.
    const first = await requestRaw({
      tls: false,
      port: h.port,
      path: "/v0/me",
      headers: {
        authorization: `Bearer ${paired.token}`,
        cookie: "teamhub_session=spoofed",
      },
    });
    expect(first.status).toBe(200);
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(seenCookies[0]).toBe("teamhub_session=initial_session_cookie");

    // POST /v0/session refreshes stored cookie while stripping Set-Cookie from mobile response.
    const renew = await requestRaw({
      tls: false,
      port: h.port,
      method: "POST",
      path: "/v0/session",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(renew.status).toBe(200);
    expect(renew.headers["set-cookie"]).toBeUndefined();

    // Subsequent call sends the refreshed session cookie to TeamHub.
    const second = await requestRaw({
      tls: false,
      port: h.port,
      path: "/v0/me",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(second.status).toBe(200);
    expect(seenCookies[2]).toBe("teamhub_session=rotated_session_42");
  });

  it("streams /v0/events SSE without buffering and aborts immediately when the device is revoked", async () => {
    let upstreamClosed = false;
    let resolveUpstreamClosed!: () => void;
    const upstreamClosedPromise = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve;
    });

    const h = await createHarness({
      tls: false,
      teamhubHandler: (req, res) => {
        if (req.url === "/v0/events") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          });
          res.flushHeaders();
          res.write("event: ping\ndata: hello\n\n");
          req.on("close", () => {
            upstreamClosed = true;
            resolveUpstreamClosed();
          });
          return;
        }
        res.writeHead(404);
        res.end();
      },
    });
    const paired = await pairOne(h);

    const sseDone = new Promise<{
      closed: boolean;
      received: string;
      header: string | string[] | undefined;
    }>((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: h.port,
          path: "/v0/events",
          headers: { authorization: `Bearer ${paired.token}` },
        },
        (res) => {
          let received = "";
          res.on("data", (chunk: Buffer) => {
            received += chunk.toString("utf8");
            if (received.includes("data: hello")) {
              // Live SSE connection should be tracked for this device.
              expect(
                h.gateway.activeConnectionsForDevice(paired.device_id).sse,
              ).toBe(1);
              // Revoking the device must tear down the SSE stream immediately.
              h.pairing.revokeDevice(paired.device_id);
            }
          });
          res.on("close", () =>
            resolve({
              closed: true,
              received,
              header: res.headers["x-accel-buffering"],
            }),
          );
          res.on("error", () =>
            resolve({
              closed: true,
              received,
              header: res.headers["x-accel-buffering"],
            }),
          );
        },
      );
      req.on("error", () => {
        // Socket destroy on revocation triggers ECONNRESET/aborted on client.
      });
      req.end();
    });

    const result = await sseDone;
    await upstreamClosedPromise;
    expect(result.closed).toBe(true);
    expect(result.received).toContain("data: hello");
    expect(result.header).toBe("no");
    expect(upstreamClosed).toBe(true);
    expect(h.gateway.activeConnectionsForDevice(paired.device_id).total).toBe(
      0,
    );
  });

  it("proxies WebSocket /document-collaboration/* upgrades and tears down sockets on revocation", async () => {
    let upstreamSocketClosed = false;
    let resolveUpstreamClosed!: () => void;
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve;
    });

    const h = await createHarness({
      tls: false,
      docUpgrade: (req, socket) => {
        // Companion bearer token must not leak upstream.
        expect(req.headers.authorization).toBeUndefined();
        expect(req.url).toBe("/document-collaboration/doc_1?token=abc");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
        );
        socket.on("data", (chunk: Buffer) => {
          socket.write(Buffer.from(`echo:${chunk.toString("utf8")}`));
        });
        // Node http.Server sockets have allowHalfOpen=true; finish closing on FIN.
        socket.on("end", () => socket.end());
        socket.on("close", () => {
          upstreamSocketClosed = true;
          resolveUpstreamClosed();
        });
      },
    });
    const paired = await pairOne(h);

    // Unauthenticated upgrade is rejected with 401.
    const unauthStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: h.port,
        path: "/document-collaboration/doc_1",
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
        },
      });
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(unauthStatus).toBe(401);

    // Authenticated upgrade relays frames and tears down immediately upon device revocation.
    const echoed = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: h.port,
        path: "/document-collaboration/doc_1?token=abc",
        agent: false,
        headers: {
          authorization: `Bearer ${paired.token}`,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
        },
      });
      req.on("upgrade", (_res, socket) => {
        expect(h.gateway.activeConnectionsForDevice(paired.device_id).ws).toBe(
          1,
        );
        let received = "";
        socket.on("data", (chunk: Buffer) => {
          received += chunk.toString("utf8");
          if (received === "echo:ping-doc") {
            h.pairing.revokeDevice(paired.device_id);
          }
        });
        socket.once("close", () => resolve(received));
        socket.write("ping-doc");
      });
      req.on("error", reject);
      req.end();
    });

    await upstreamClosed;
    expect(echoed).toBe("echo:ping-doc");
    expect(upstreamSocketClosed).toBe(true);
    expect(h.gateway.activeConnectionsForDevice(paired.device_id).total).toBe(
      0,
    );
  });

  it("blocks encoded delimiter/case bypasses on forbidden /v0/* paths and safely proxies percent-encoded UTF-8 paths", async () => {
    const upstreamHits: string[] = [];
    const h = await createHarness({
      tls: false,
      teamhubHandler: (req, res) => {
        upstreamHits.push(`${req.method ?? "GET"} ${req.url ?? ""}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, received_url: req.url }));
      },
      docUpgrade: (req, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
        );
        socket.end(req.url ?? "");
      },
    });
    const paired = await pairOne(h);

    // Encoded query/fragment delimiters must be rejected with 400 and never reach upstream.
    for (const bypassPath of [
      "/v0/local/identity%3f",
      "/v0/auth/login%3f",
      "/v0/auth/logout%3f",
      "/v0/account/password%3f",
      "/v0/tenants/t1/local-computer-enrollments%3f",
      "/v0/local/identity%23foo",
      "/v0/rooms/room_1%0d%0a",
    ]) {
      const res = await requestRaw({
        tls: false,
        port: h.port,
        method: "POST",
        path: bypassPath,
        headers: { authorization: `Bearer ${paired.token}` },
      });
      expect(res.status, `path ${bypassPath} must be rejected`).toBe(400);
    }

    // Upper/mixed-case forbidden paths must return 403 and never reach upstream.
    for (const casedPath of [
      "/v0/LOCAL/IDENTITY",
      "/v0/Auth/Login",
      "/v0/Tenants/t1/LOCAL-COMPUTER-ENROLLMENTS",
    ]) {
      const res = await requestRaw({
        tls: false,
        port: h.port,
        method: "POST",
        path: casedPath,
        headers: { authorization: `Bearer ${paired.token}` },
      });
      expect(res.status, `path ${casedPath} must return 403`).toBe(403);
    }
    expect(upstreamHits).toEqual([]);

    // Valid percent-encoded spaces and UTF-8 emoji reactions proxy cleanly without ERR_UNESCAPED_CHARACTERS.
    const spaced = await requestRaw({
      tls: false,
      port: h.port,
      path: "/v0/rooms/my%20room?limit=10",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(spaced.status).toBe(200);
    expect(JSON.parse(spaced.body)).toEqual({
      ok: true,
      received_url: "/v0/rooms/my%20room?limit=10",
    });

    const emoji = await requestRaw({
      tls: false,
      port: h.port,
      method: "PUT",
      path: "/v0/document-comments/c1/reactions/%F0%9F%91%8D",
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(emoji.status).toBe(200);
    expect(JSON.parse(emoji.body)).toEqual({
      ok: true,
      received_url: "/v0/document-comments/c1/reactions/%F0%9F%91%8D",
    });

    // Percent-encoded space on WebSocket upgrade must not throw an uncaught exception.
    const wsReceived = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: h.port,
        path: "/document-collaboration/doc%20name?token=abc",
        agent: false,
        headers: {
          authorization: `Bearer ${paired.token}`,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
        },
      });
      req.on("upgrade", (_res, socket, head) => {
        let out = head.toString("utf8");
        socket.on("data", (chunk: Buffer) => {
          out += chunk.toString("utf8");
        });
        socket.once("end", () => resolve(out));
        socket.once("close", () => resolve(out));
      });
      req.on("error", reject);
      req.end();
    });
    expect(wsReceived).toBe("/document-collaboration/doc%20name?token=abc");
  });

  it("sweeps expired pairing rate-limit buckets", async () => {
    const h = await createHarness({
      tls: false,
      pairRateLimitMax: 2,
      pairRateLimitWindowMs: 25,
    });
    h.pairing.openPairingWindow();

    await requestRaw({
      tls: false,
      port: h.port,
      method: "POST",
      path: "/companion/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pin: "000001",
        device_name: "A",
        platform: "ios",
      }),
    });
    expect(h.gateway.pairRateBucketCount()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 40));

    // After window expiry, a new request succeeds cleanly without stale accumulation.
    const fresh = await requestRaw({
      tls: false,
      port: h.port,
      method: "POST",
      path: "/companion/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pin: "000001",
        device_name: "A",
        platform: "ios",
      }),
    });
    expect(fresh.status).toBe(401);
    expect(h.gateway.pairRateBucketCount()).toBe(1);
  });
});
