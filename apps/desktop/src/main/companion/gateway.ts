import http, {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import type { Duplex } from "node:stream";

import type { Logger } from "../log.js";
import type { HerdrCoreLocalBridge } from "../herdr-core/local-bridge.js";
import {
  discoverAddresses,
  isAllowedHostHeader,
  type DiscoveredAddresses,
} from "./network.js";
import { extractSessionFromSetCookie, type PairingManager } from "./pairing.js";
import type { TlsMaterial } from "./tls.js";

export interface CompanionRuntimeStatusSnapshot {
  readonly computer_id: string | null;
  readonly daemon_connection: string;
  readonly runtime_state: string;
  readonly active_operations: number;
  readonly prevent_sleep: boolean;
  readonly local_server_phase: string;
  readonly local_models_degraded: boolean;
  readonly server_url_mode: "local" | "remote" | "unconfigured";
}

export interface CompanionGatewayOptions {
  readonly bindHost?: string;
  readonly port: number;
  readonly tls: boolean;
  readonly tlsMaterial?: TlsMaterial;
  readonly pairing: PairingManager;
  readonly hostId: string;
  readonly getHostName: () => string;
  readonly desktopVersion: string;
  readonly customHost?: string;
  readonly hostname?: string;
  readonly getAddresses?: () => DiscoveredAddresses;
  readonly getTeamHubBaseUrl: () => string | undefined;
  readonly getDocumentRuntimeUrl: () => string | undefined;
  readonly getStatusSnapshot: () => CompanionRuntimeStatusSnapshot;
  readonly getHerdrCoreBridge?: () => HerdrCoreLocalBridge | undefined;
  readonly onConnectionsChanged?: () => void;
  readonly log?: Logger;
  readonly pairRateLimitMax?: number;
  readonly pairRateLimitWindowMs?: number;
}

interface ActiveConnection {
  readonly id: number;
  readonly deviceId: string;
  kind: "http" | "sse" | "ws";
  readonly destroy: () => void;
}

const MAX_JSON_BODY_BYTES = 16 * 1024;
const ADDRESS_CACHE_TTL_MS = 10_000;
const DEFAULT_PAIR_RATE_LIMIT_MAX = 15;
const DEFAULT_PAIR_RATE_LIMIT_WINDOW_MS = 60_000;

const STRIPPED_UPSTREAM_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const FORBIDDEN_V0_EXACT_OR_PREFIX = [
  "/v0/local/identity",
  "/v0/auth/login",
  "/v0/auth/logout",
  "/v0/account/password",
  "/v0/local-computer-enrollments",
];

const TENANT_ENROLLMENTS_PATTERN =
  /^\/v0\/tenants\/[^/]+\/local-computer-enrollments(?:\/|$)/u;

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: OutgoingHttpHeaders = {},
): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function writeError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  extraHeaders: OutgoingHttpHeaders = {},
): void {
  writeJson(res, status, { error: { code, message } }, extraHeaders);
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (!socket.destroyed) {
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
}

interface NormalizedUrlResult {
  readonly ok: true;
  readonly pathname: string;
  readonly encodedPath: string;
  readonly search: string;
}

type ParsePathResult =
  | NormalizedUrlResult
  | { readonly ok: false; readonly reason: string };

// Reject percent-encoded traversal/delimiter/control bytes before decoding.
const FORBIDDEN_RAW_PATH_ENCODINGS =
  /(?:%2e|%2f|%5c|%3f|%23|%0[0-9a-f]|%1[0-9a-f]|%7f)/iu;

// Reject ASCII control characters, whitespace, backslash, and query/fragment delimiters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_RAW_PATH_CHARS = /[\x00-\x20\x7f\\?#]/u;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_DECODED_PATH_CHARS = /[\x00-\x1f\x7f\\?#]/u;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_SEARCH_CHARS = /[\x00-\x20\x7f#]/u;

export function normalizeRequestPath(
  rawUrl: string | undefined,
): ParsePathResult {
  const value = rawUrl ?? "/";
  const qIndex = value.indexOf("?");
  const rawPath = qIndex === -1 ? value : value.slice(0, qIndex);
  const search = qIndex === -1 ? "" : value.slice(qIndex);

  if (
    !rawPath.startsWith("/") ||
    FORBIDDEN_RAW_PATH_CHARS.test(rawPath) ||
    FORBIDDEN_RAW_PATH_ENCODINGS.test(rawPath) ||
    FORBIDDEN_SEARCH_CHARS.test(search)
  ) {
    return { ok: false, reason: "invalid_path" };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { ok: false, reason: "malformed_encoding" };
  }

  if (FORBIDDEN_DECODED_PATH_CHARS.test(decoded)) {
    return { ok: false, reason: "invalid_path" };
  }

  const segments = decoded.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "path_traversal" };
    }
  }

  const collapsed = decoded.replace(/\/{2,}/gu, "/");
  const encodedPath =
    collapsed === "/"
      ? "/"
      : collapsed
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/");

  return { ok: true, pathname: collapsed, encodedPath, search };
}

export function isForbiddenV0Path(pathname: string): boolean {
  const lower = pathname.split(/[?#]/u, 1)[0]!.toLowerCase();
  for (const blocked of FORBIDDEN_V0_EXACT_OR_PREFIX) {
    if (lower === blocked || lower.startsWith(`${blocked}/`)) {
      return true;
    }
  }
  return TENANT_ENROLLMENTS_PATTERN.test(lower);
}

function parseBearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") return undefined;
  const match = /^Bearer\s+(\S+)$/iu.exec(auth.trim());
  return match?.[1];
}

function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    }
> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (
      result:
        | { readonly ok: true; readonly data: unknown }
        | {
            readonly ok: false;
            readonly status: number;
            readonly code: string;
            readonly message: string;
          },
    ): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.resume();
        finish({
          ok: false,
          status: 413,
          code: "INVALID_REQUEST",
          message: "Request body is too large.",
        });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        finish({
          ok: false,
          status: 400,
          code: "INVALID_REQUEST",
          message: "Request body must be a JSON object.",
        });
        return;
      }
      try {
        finish({ ok: true, data: JSON.parse(text) as unknown });
      } catch {
        finish({
          ok: false,
          status: 400,
          code: "INVALID_REQUEST",
          message: "Request body must be valid JSON.",
        });
      }
    });

    req.on("error", () => {
      finish({
        ok: false,
        status: 400,
        code: "INVALID_REQUEST",
        message: "Failed to read request body.",
      });
    });
  });
}

function buildUpstreamHeaders(
  req: IncomingMessage,
  targetHost: string,
  extra: Record<string, string | undefined>,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (STRIPPED_UPSTREAM_HEADERS.has(lower) || value === undefined) continue;
    headers[lower] = value;
  }
  headers.host = targetHost;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) headers[key] = value;
  }
  return headers;
}

function isSsePath(pathname: string): boolean {
  return (
    pathname === "/v0/events" ||
    /^\/v0\/voice-sessions\/[^/]+\/events\/stream$/u.test(pathname)
  );
}

export class CompanionGateway {
  readonly #options: CompanionGatewayOptions;
  readonly #hostname: string;
  readonly #getAddresses: () => DiscoveredAddresses;
  readonly #pairRateLimitMax: number;
  readonly #pairRateLimitWindowMs: number;
  readonly #pairRateBuckets = new Map<string, number[]>();
  readonly #connections = new Map<number, ActiveConnection>();
  readonly #sockets = new Set<Duplex>();
  #nextConnectionId = 1;
  #server: http.Server | https.Server | undefined;
  #listenPort: number | undefined;
  #cachedAddresses:
    | { readonly at: number; readonly value: DiscoveredAddresses }
    | undefined;

  constructor(options: CompanionGatewayOptions) {
    if (options.tls && !options.tlsMaterial) {
      throw new Error("CompanionGateway requires tlsMaterial when tls is true");
    }
    this.#options = options;
    this.#hostname = options.hostname ?? os.hostname();
    this.#getAddresses = options.getAddresses ?? (() => discoverAddresses());
    this.#pairRateLimitMax =
      options.pairRateLimitMax ?? DEFAULT_PAIR_RATE_LIMIT_MAX;
    this.#pairRateLimitWindowMs =
      options.pairRateLimitWindowMs ?? DEFAULT_PAIR_RATE_LIMIT_WINDOW_MS;
  }

  running(): boolean {
    return this.#server !== undefined;
  }

  port(): number | undefined {
    return this.#listenPort;
  }

  tlsEnabled(): boolean {
    return this.#options.tls;
  }

  tlsFingerprint(): string {
    return this.#options.tlsMaterial?.fingerprint ?? "";
  }

  activeConnectionsForDevice(deviceId: string): {
    readonly total: number;
    readonly sse: number;
    readonly ws: number;
  } {
    let total = 0;
    let sse = 0;
    let ws = 0;
    for (const conn of this.#connections.values()) {
      if (conn.deviceId !== deviceId) continue;
      total += 1;
      if (conn.kind === "sse") sse += 1;
      if (conn.kind === "ws") ws += 1;
    }
    return { total, sse, ws };
  }

  revokeDeviceConnections(deviceId: string): void {
    const victims: ActiveConnection[] = [];
    for (const conn of this.#connections.values()) {
      if (conn.deviceId === deviceId) victims.push(conn);
    }
    for (const conn of victims) {
      this.#connections.delete(conn.id);
      try {
        conn.destroy();
      } catch {
        // Ignore teardown errors on already closed sockets.
      }
    }
    if (victims.length > 0) {
      this.#options.onConnectionsChanged?.();
    }
  }

  async start(): Promise<number> {
    if (this.#server && this.#listenPort !== undefined) {
      return this.#listenPort;
    }

    const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
      void this.#handleHttpRequest(req, res).catch((error: unknown) => {
        this.#options.log?.warn("companion.request_error", {
          error: String(error),
        });
        writeError(res, 500, "INTERNAL_ERROR", "Internal gateway error.");
      });
    };

    const server = this.#options.tls
      ? https.createServer(
          {
            cert: this.#options.tlsMaterial!.certPem,
            key: this.#options.tlsMaterial!.keyPem,
            minVersion: "TLSv1.3",
          },
          onRequest,
        )
      : http.createServer(onRequest);

    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });

    server.on("upgrade", (req, socket, head) => {
      this.#handleUpgrade(req, socket, head);
    });

    const bindHost = this.#options.bindHost ?? "0.0.0.0";
    const boundPort = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#options.port, bindHost, () => {
        server.off("error", reject);
        const addr = server.address() as AddressInfo | null;
        if (!addr) {
          reject(new Error("Gateway bound without address"));
          return;
        }
        resolve(addr.port);
      });
    });

    this.#server = server;
    this.#listenPort = boundPort;
    this.#options.log?.info("companion.gateway_started", {
      bind_host: bindHost,
      port: boundPort,
      tls: this.#options.tls,
    });
    return boundPort;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#listenPort = undefined;

    for (const conn of [...this.#connections.values()]) {
      this.#connections.delete(conn.id);
      try {
        conn.destroy();
      } catch {
        // Ignore teardown errors.
      }
    }
    this.#options.onConnectionsChanged?.();

    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      for (const socket of this.#sockets) {
        if (!socket.destroyed) socket.destroy();
      }
      this.#sockets.clear();
    });
    this.#options.log?.info("companion.gateway_stopped", {});
  }

  #addresses(): DiscoveredAddresses {
    const now = Date.now();
    if (
      !this.#cachedAddresses ||
      now - this.#cachedAddresses.at > ADDRESS_CACHE_TTL_MS
    ) {
      this.#cachedAddresses = { at: now, value: this.#getAddresses() };
    }
    return this.#cachedAddresses.value;
  }

  #checkRequestGuards(req: IncomingMessage):
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly status: number;
        readonly code: string;
        readonly message: string;
      } {
    // Reject browser-originated and cross-site requests (CSRF defense).
    if (req.headers.origin !== undefined) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN_ORIGIN",
        message: "Browser Origin headers are not permitted.",
      };
    }
    const fetchSite = req.headers["sec-fetch-site"];
    if (
      typeof fetchSite === "string" &&
      fetchSite.trim().toLowerCase() === "cross-site"
    ) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN_ORIGIN",
        message: "Cross-site requests are not permitted.",
      };
    }

    // Validate Host header against local interfaces, Tailscale, and customHost
    // (DNS rebinding defense).
    const addresses = this.#addresses();
    const localIps = new Set<string>(addresses.allIps);
    if (
      !isAllowedHostHeader(req.headers.host, {
        localIps,
        hostname: this.#hostname,
        ...(this.#options.customHost
          ? { customHost: this.#options.customHost }
          : {}),
      })
    ) {
      return {
        ok: false,
        status: 403,
        code: "INVALID_HOST",
        message: "Host header is not permitted.",
      };
    }

    return { ok: true };
  }

  pairRateBucketCount(): number {
    return this.#pairRateBuckets.size;
  }

  #checkPairRateLimit(ip: string): number {
    const now = Date.now();
    const cutoff = now - this.#pairRateLimitWindowMs;
    for (const [key, timestamps] of this.#pairRateBuckets) {
      if (key === ip) continue;
      const active = timestamps.filter((ts) => ts > cutoff);
      if (active.length === 0) {
        this.#pairRateBuckets.delete(key);
      } else if (active.length !== timestamps.length) {
        this.#pairRateBuckets.set(key, active);
      }
    }
    const bucket = (this.#pairRateBuckets.get(ip) ?? []).filter(
      (ts) => ts > cutoff,
    );
    if (bucket.length >= this.#pairRateLimitMax) {
      this.#pairRateBuckets.set(ip, bucket);
      const oldest = bucket[0] ?? now;
      return Math.max(
        1,
        Math.ceil((oldest + this.#pairRateLimitWindowMs - now) / 1000),
      );
    }
    bucket.push(now);
    this.#pairRateBuckets.set(ip, bucket);
    return 0;
  }

  #trackConnection(conn: Omit<ActiveConnection, "id">): number {
    const id = this.#nextConnectionId;
    this.#nextConnectionId += 1;
    this.#connections.set(id, { id, ...conn });
    this.#options.onConnectionsChanged?.();
    return id;
  }

  #untrackConnection(id: number): void {
    if (this.#connections.delete(id)) {
      this.#options.onConnectionsChanged?.();
    }
  }

  async #handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const guard = this.#checkRequestGuards(req);
    if (!guard.ok) {
      writeError(res, guard.status, guard.code, guard.message);
      return;
    }

    const parsedPath = normalizeRequestPath(req.url);
    if (!parsedPath.ok) {
      writeError(res, 400, "INVALID_REQUEST", "Invalid request path.");
      return;
    }

    const { pathname, encodedPath, search } = parsedPath;
    const method = (req.method ?? "GET").toUpperCase();

    // Companion control plane endpoints.
    if (pathname === "/companion/v1/info") {
      if (method !== "GET") {
        writeError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
        return;
      }
      const addrs = this.#addresses();
      writeJson(res, 200, {
        protocol_version: 1,
        host_id: this.#options.hostId,
        host_name: this.#options.getHostName(),
        desktop_version: this.#options.desktopVersion,
        pairing_open: this.#options.pairing.isPairingOpen(),
        tls: this.#options.tls,
        tls_fingerprint: this.tlsFingerprint(),
        addresses: {
          lan: addrs.lan,
          tailscale: addrs.tailscale,
        },
      });
      return;
    }

    if (pathname === "/companion/v1/pair") {
      if (method !== "POST") {
        writeError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
        return;
      }
      const clientIp = req.socket.remoteAddress ?? "unknown";
      const retryAfter = this.#checkPairRateLimit(clientIp);
      if (retryAfter > 0) {
        writeError(
          res,
          429,
          "RATE_LIMITED",
          "Too many pairing requests from this address; try again later.",
          { "retry-after": String(retryAfter) },
        );
        return;
      }
      const bodyResult = await readJsonBody(req, MAX_JSON_BODY_BYTES);
      if (!bodyResult.ok) {
        writeError(res, bodyResult.status, bodyResult.code, bodyResult.message);
        return;
      }
      const outcome = await this.#options.pairing.pair(bodyResult.data);
      if (!outcome.ok) {
        writeError(res, outcome.status, outcome.code, outcome.message);
        return;
      }
      writeJson(res, 200, outcome.payload);
      return;
    }

    if (
      pathname === "/companion/v1/status" ||
      pathname === "/companion/v1/token/rotate" ||
      pathname === "/companion/v1/unpair"
    ) {
      const token = parseBearerToken(req);
      const device = token
        ? this.#options.pairing.authenticateToken(token)
        : undefined;
      if (!device) {
        writeError(
          res,
          401,
          "UNAUTHORIZED",
          "Valid companion bearer token required.",
        );
        return;
      }
      this.#options.pairing.touchDevice(device.device_id);

      if (pathname === "/companion/v1/status") {
        if (method !== "GET") {
          writeError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
          return;
        }
        const snap = this.#options.getStatusSnapshot();
        writeJson(res, 200, {
          host_id: this.#options.hostId,
          host_name: this.#options.getHostName(),
          desktop_version: this.#options.desktopVersion,
          computer_id: snap.computer_id,
          daemon_connection: snap.daemon_connection,
          runtime_state: snap.runtime_state,
          active_operations: snap.active_operations,
          prevent_sleep: snap.prevent_sleep,
          local_server_phase: snap.local_server_phase,
          local_models_degraded: snap.local_models_degraded,
          server_url_mode: snap.server_url_mode,
          device_id: device.device_id,
          paired_devices_count: this.#options.pairing.deviceCount(),
        });
        return;
      }

      if (pathname === "/companion/v1/token/rotate") {
        if (method !== "POST") {
          writeError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
          return;
        }
        const rotated = this.#options.pairing.rotateToken(device.device_id);
        if (!rotated) {
          writeError(res, 401, "UNAUTHORIZED", "Device is no longer paired.");
          return;
        }
        writeJson(res, 200, rotated);
        return;
      }

      if (method !== "POST") {
        writeError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
        return;
      }
      this.#options.pairing.revokeDevice(device.device_id);
      writeJson(res, 200, { unpaired: true });
      return;
    }

    // Local direct herdr-core bridge for authenticated LAN Companion clients.
    if (
      pathname === "/companion/v1/herdr-core" ||
      pathname.startsWith("/companion/v1/herdr-core/")
    ) {
      const token = parseBearerToken(req);
      const device = token
        ? this.#options.pairing.authenticateToken(token)
        : undefined;
      if (!device) {
        writeError(
          res,
          401,
          "UNAUTHORIZED",
          "Valid companion bearer token required.",
        );
        return;
      }
      this.#options.pairing.touchDevice(device.device_id);
      const bridge = this.#options.getHerdrCoreBridge?.();
      if (!bridge || !bridge.running()) {
        writeError(
          res,
          503,
          "HERDR_CORE_UNAVAILABLE",
          "Local herdr-core bridge is not available.",
        );
        return;
      }
      const subPath = pathname.slice("/companion/v1/herdr-core".length) || "/";
      await bridge.handleDelegatedHttpRequest(req, res, subPath, search);
      return;
    }

    // TeamHub reverse proxy: only /v0/* paths are exposed.
    if (pathname === "/v0" || pathname.startsWith("/v0/")) {
      if (isForbiddenV0Path(pathname)) {
        writeError(
          res,
          403,
          "FORBIDDEN_PATH",
          "This endpoint is not accessible via the mobile companion gateway.",
        );
        return;
      }

      const token = parseBearerToken(req);
      const device = token
        ? this.#options.pairing.authenticateToken(token)
        : undefined;
      if (!device) {
        writeError(
          res,
          401,
          "UNAUTHORIZED",
          "Valid companion bearer token required.",
        );
        return;
      }
      this.#options.pairing.touchDevice(device.device_id);

      const session = this.#options.pairing.getDeviceSession(device.device_id);
      if (!session) {
        writeError(
          res,
          401,
          "SESSION_UNAVAILABLE",
          "No active TeamHub session for this device.",
        );
        return;
      }

      const teamhubBase = this.#options.getTeamHubBaseUrl();
      if (!teamhubBase) {
        writeError(
          res,
          503,
          "UPSTREAM_UNAVAILABLE",
          "TeamHub server is not available.",
        );
        return;
      }

      this.#proxyTeamHubRequest(
        req,
        res,
        device.device_id,
        session.session_cookie,
        teamhubBase,
        pathname,
        encodedPath,
        search,
      );
      return;
    }

    // All other paths (/, /install/*, /v1/*, /api/agent/*, /internal/*, etc.)
    // are intentionally never exposed.
    writeError(res, 404, "NOT_FOUND", "Not found.");
  }

  #proxyTeamHubRequest(
    req: IncomingMessage,
    res: ServerResponse,
    deviceId: string,
    sessionCookie: string,
    teamhubBase: string,
    pathname: string,
    encodedPath: string,
    search: string,
  ): void {
    const target = new URL(teamhubBase);
    const requester =
      target.protocol === "https:" ? https.request : http.request;
    const isSessionRefresh =
      (req.method ?? "GET").toUpperCase() === "POST" &&
      pathname === "/v0/session";
    const initialSse = isSsePath(pathname);

    const upstreamHeaders = buildUpstreamHeaders(req, target.host, {
      cookie: `teamhub_session=${sessionCookie}`,
      "x-forwarded-for": req.socket.remoteAddress ?? "",
    });

    let upstreamRes: IncomingMessage | undefined;
    let cleanedUp = false;

    const upstreamReq = requester({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: `${encodedPath}${search}`,
      headers: upstreamHeaders,
    });

    const connId = this.#trackConnection({
      deviceId,
      kind: initialSse ? "sse" : "http",
      destroy: () => {
        upstreamReq.destroy();
        upstreamRes?.destroy();
        if (!res.destroyed) res.destroy();
      },
    });

    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.#untrackConnection(connId);
    };

    upstreamReq.on("response", (reply) => {
      upstreamRes = reply;
      const contentType = String(reply.headers["content-type"] ?? "");
      const isSse =
        initialSse || contentType.toLowerCase().includes("text/event-stream");
      if (isSse) {
        const tracked = this.#connections.get(connId);
        if (tracked && tracked.kind !== "sse") {
          tracked.kind = "sse";
          this.#options.onConnectionsChanged?.();
        }
      }

      if (
        isSessionRefresh &&
        reply.statusCode !== undefined &&
        reply.statusCode >= 200 &&
        reply.statusCode < 300
      ) {
        const refreshed = extractSessionFromSetCookie(
          reply.headers["set-cookie"],
        );
        if (refreshed) {
          this.#options.pairing.updateDeviceSession(deviceId, refreshed);
        }
      }

      // Copy response headers, always stripping Set-Cookie so mobile never
      // receives raw TeamHub session cookies.
      const outHeaders: OutgoingHttpHeaders = {};
      for (const [key, value] of Object.entries(reply.headers)) {
        const lower = key.toLowerCase();
        if (lower === "set-cookie" || value === undefined) continue;
        outHeaders[lower] = value;
      }

      if (isSse) {
        outHeaders["x-accel-buffering"] = "no";
        if (!outHeaders["cache-control"]) {
          outHeaders["cache-control"] = "no-cache, no-transform";
        }
        req.socket.setNoDelay(true);
      }

      res.writeHead(reply.statusCode ?? 502, reply.statusMessage, outHeaders);
      if (isSse) {
        res.flushHeaders();
      }
      reply.pipe(res);
      reply.on("end", cleanup);
      reply.on("close", cleanup);
      reply.on("error", () => {
        cleanup();
        if (!res.destroyed) res.destroy();
      });
    });

    upstreamReq.on("error", (error) => {
      cleanup();
      if (!res.headersSent) {
        writeError(
          res,
          502,
          "UPSTREAM_ERROR",
          "Upstream TeamHub request failed.",
        );
      } else if (!res.destroyed) {
        res.destroy();
      }
      this.#options.log?.warn("companion.proxy_error", {
        path: pathname,
        error: String(error),
      });
    });

    res.on("close", () => {
      cleanup();
      if (!res.writableEnded) {
        upstreamReq.destroy();
        upstreamRes?.destroy();
      }
    });

    req.on("aborted", () => {
      cleanup();
      upstreamReq.destroy();
      upstreamRes?.destroy();
    });

    req.pipe(upstreamReq);
  }

  #handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    try {
      this.#handleUpgradeInner(req, socket, head);
    } catch (error) {
      rejectUpgrade(socket, 400, "Bad Request");
      this.#options.log?.warn("companion.ws_upgrade_error", {
        path: req.url ?? "",
        error: String(error),
      });
    }
  }

  #handleUpgradeInner(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const guard = this.#checkRequestGuards(req);
    if (!guard.ok) {
      rejectUpgrade(socket, guard.status, "Forbidden");
      return;
    }

    const parsedPath = normalizeRequestPath(req.url);
    if (!parsedPath.ok) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    const { pathname, encodedPath, search } = parsedPath;
    if (pathname === "/companion/v1/herdr-core/attach") {
      const token = parseBearerToken(req);
      const device = token
        ? this.#options.pairing.authenticateToken(token)
        : undefined;
      if (!device) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      this.#options.pairing.touchDevice(device.device_id);
      const bridge = this.#options.getHerdrCoreBridge?.();
      if (!bridge || !bridge.running()) {
        rejectUpgrade(socket, 503, "Service Unavailable");
        return;
      }
      const connId = this.#trackConnection({
        deviceId: device.device_id,
        kind: "ws",
        destroy: () => {
          if (!socket.destroyed) socket.destroy();
        },
      });
      const untrack = (): void => this.#untrackConnection(connId);
      socket.once("close", untrack);
      socket.once("error", untrack);
      bridge.handleDelegatedUpgrade(req, socket, head, "/attach", search);
      return;
    }

    if (
      pathname !== "/document-collaboration" &&
      !pathname.startsWith("/document-collaboration/")
    ) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const token = parseBearerToken(req);
    const device = token
      ? this.#options.pairing.authenticateToken(token)
      : undefined;
    if (!device) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    this.#options.pairing.touchDevice(device.device_id);

    const docRuntimeBase = this.#options.getDocumentRuntimeUrl();
    if (!docRuntimeBase) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    const target = new URL(docRuntimeBase);
    const isHttps = target.protocol === "https:" || target.protocol === "wss:";
    const requester = isHttps ? https.request : http.request;

    const upstreamHeaders = buildUpstreamHeaders(req, target.host, {
      "x-forwarded-for": req.socket.remoteAddress ?? "",
    });

    const upstreamReq = requester({
      protocol: isHttps ? "https:" : "http:",
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      method: req.method ?? "GET",
      path: `${encodedPath}${search}`,
      headers: upstreamHeaders,
      agent: false,
    });

    let upstreamSocketRef: Duplex | undefined;
    let cleanedUp = false;

    const connId = this.#trackConnection({
      deviceId: device.device_id,
      kind: "ws",
      destroy: () => {
        upstreamReq.destroy();
        if (upstreamSocketRef && !upstreamSocketRef.destroyed) {
          upstreamSocketRef.destroy();
        }
        if (!socket.destroyed) socket.destroy();
      },
    });

    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.#untrackConnection(connId);
    };

    upstreamReq.on("upgrade", (reply, upstreamSocket, upstreamHead) => {
      upstreamSocketRef = upstreamSocket;
      const lines = [
        `HTTP/1.1 101 ${reply.statusMessage || "Switching Protocols"}`,
      ];
      for (let i = 0; i < reply.rawHeaders.length; i += 2) {
        const name = reply.rawHeaders[i]!;
        const value = reply.rawHeaders[i + 1]!;
        if (name.toLowerCase() === "set-cookie") continue;
        lines.push(`${name}: ${value}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);

      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);

      const teardown = (): void => {
        cleanup();
        if (!upstreamSocket.destroyed) upstreamSocket.destroy();
        if (!socket.destroyed) socket.destroy();
      };
      upstreamSocket.on("close", teardown);
      upstreamSocket.on("error", teardown);
      socket.on("close", teardown);
      socket.on("error", teardown);
    });

    upstreamReq.on("response", (reply) => {
      reply.resume();
      cleanup();
      rejectUpgrade(
        socket,
        reply.statusCode ?? 502,
        reply.statusMessage ?? "Bad Gateway",
      );
    });

    upstreamReq.on("error", (error) => {
      cleanup();
      rejectUpgrade(socket, 502, "Bad Gateway");
      this.#options.log?.warn("companion.ws_proxy_error", {
        path: pathname,
        error: String(error),
      });
    });

    socket.on("error", () => {
      cleanup();
      upstreamReq.destroy();
      if (upstreamSocketRef && !upstreamSocketRef.destroyed) {
        upstreamSocketRef.destroy();
      }
    });

    upstreamReq.end();
  }
}
