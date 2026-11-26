import { randomBytes, timingSafeEqual } from "node:crypto";
import http, {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import type { Logger } from "../log.js";
import { sameOrigin } from "../navigation.js";
import {
  detectHerdrCore,
  startHerdrCoreServer,
  type HerdrCoreDetectorDeps,
} from "./detector.js";
import {
  callHerdrCoreRpc,
  decodeResizePayload,
  FrameKind,
  HerdrCoreFramedSession,
  HerdrCoreRpcError,
  type HerdrCoreDialTarget,
} from "./protocol.js";
import {
  MAX_HERDR_CORE_DOC_BYTES,
  MAX_HERDR_CORE_PUT_BYTES,
  terminalStatusWord,
  type HerdrCoreBridgeConnectionInfo,
  type HerdrCoreDetection,
  type HerdrCoreMachine,
  type HerdrCoreStartServerResult,
  type HerdrCoreStatusPayload,
  type HerdrCoreTerminal,
} from "./types.js";
import {
  acceptWebSocket,
  type WebSocketServerConnection,
} from "./ws-server.js";

const DEFAULT_MAX_JSON_BODY_BYTES = 24 * 1024 * 1024;
const DEFAULT_SMALL_JSON_BODY_BYTES = 2 * 1024 * 1024;

export interface HerdrCoreLocalBridgeOptions {
  readonly port?: number;
  readonly token?: string;
  readonly maxPutBytes?: number;
  readonly getAllowedOrigin?: () => string | undefined;
  readonly detectorDeps?: HerdrCoreDetectorDeps;
  readonly dialTargetOverride?: () => HerdrCoreDialTarget;
  readonly log?: Logger;
}

interface AttachRpcResult {
  readonly channel: number;
  readonly terminal: HerdrCoreTerminal;
  readonly resize_notifications?: boolean;
  readonly automatic_input?: boolean;
}

interface ServerStatusRpcResult {
  readonly core?: { readonly id?: string; readonly name?: string };
  readonly version?: string;
  readonly pid?: number;
  readonly uptime_ms?: number;
  readonly live?: number;
  readonly finished?: number;
  readonly terminals?: { readonly live?: number; readonly finished?: number };
}

interface TerminalListRpcResult {
  readonly terminals?: readonly HerdrCoreTerminal[];
  readonly hidden_finished?: number;
  readonly machines?: readonly HerdrCoreMachine[];
}

interface MachineListRpcResult {
  readonly machines?: readonly HerdrCoreMachine[];
}

interface TemplatesListRpcResult {
  readonly templates?: readonly {
    readonly name: string;
    readonly description?: string | null;
    readonly command?: string | readonly string[] | null;
    readonly error?: string | null;
  }[];
}

interface PutRpcResult {
  readonly path?: string;
}

interface DocGetRpcResult {
  readonly value: unknown;
  readonly version: number;
}

export function validatePutFilename(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 255 ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    return null;
  }
  return trimmed;
}

export function decodeAndValidatePutBase64(
  dataBase64: unknown,
  maxBytes: number,
):
  | { readonly ok: true; readonly bytes: number; readonly normalized: string }
  | {
      readonly ok: false;
      readonly code: string;
      readonly status: number;
      readonly message: string;
    } {
  if (typeof dataBase64 !== "string") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "data_base64 must be a base64 string.",
    };
  }
  const stripped = dataBase64.replace(/\s+/gu, "");
  if (stripped.length > 0 && !/^[A-Za-z0-9+/]+={0,2}$/u.test(stripped)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "data_base64 is not valid base64.",
    };
  }
  // Quick pre-check before allocating the decoded buffer.
  const estimatedBytes = Math.floor((stripped.length * 3) / 4);
  if (estimatedBytes > maxBytes + 3) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: `Uploaded file exceeds maximum size of ${maxBytes} bytes.`,
    };
  }
  const decoded = Buffer.from(stripped, "base64");
  if (decoded.byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: `Uploaded file exceeds maximum size of ${maxBytes} bytes.`,
    };
  }
  return {
    ok: true,
    bytes: decoded.byteLength,
    normalized: decoded.toString("base64"),
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

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

function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<
  | { readonly ok: true; readonly data: Record<string, unknown> }
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
        | { readonly ok: true; readonly data: Record<string, unknown> }
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
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body is too large.",
        });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        finish({ ok: true, data: {} });
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          finish({
            ok: false,
            status: 400,
            code: "INVALID_REQUEST",
            message: "Request body must be a JSON object.",
          });
          return;
        }
        finish({ ok: true, data: parsed as Record<string, unknown> });
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

function mapRpcError(error: unknown): {
  readonly status: number;
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof HerdrCoreRpcError) {
    switch (error.kind) {
      case "not_found":
      case "machine_unknown":
        return { status: 404, code: "NOT_FOUND", message: error.message };
      case "blocked":
        return { status: 409, code: "BLOCKED", message: error.message };
      case "conflict":
      case "status_mismatch":
        return { status: 409, code: "CONFLICT", message: error.message };
      case "finished":
        return { status: 410, code: "FINISHED", message: error.message };
      case "invalid_params":
      case "usage":
        return { status: 400, code: "INVALID_REQUEST", message: error.message };
      case "unavailable":
      case "needs_update":
        return {
          status: 503,
          code: "HERDR_CORE_UNAVAILABLE",
          message: error.message,
        };
      default:
        return {
          status: 502,
          code: "HERDR_CORE_ERROR",
          message: error.message,
        };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 503,
    code: "HERDR_CORE_UNAVAILABLE",
    message,
  };
}

function extractSubPath(pathname: string): string | null {
  if (pathname === "/herdr-core" || pathname.startsWith("/herdr-core/")) {
    return pathname.slice("/herdr-core".length) || "/";
  }
  const computerMatch =
    /^\/api\/v1\/computers\/[^/]+\/herdr-core(\/.*)?$/u.exec(pathname);
  if (computerMatch) {
    return computerMatch[1] ?? "/";
  }
  return null;
}

function terminalMachineName(address: string): string {
  const slash = address.indexOf("/");
  return slash === -1 ? "local" : address.slice(0, slash);
}

function filterTerminalsList(
  terminals: readonly HerdrCoreTerminal[],
  query: URLSearchParams,
): HerdrCoreTerminal[] {
  const machine = query.get("machine")?.trim();
  const roomId = query.get("room_id")?.trim();
  const workItemId = query.get("work_item_id")?.trim();
  const status = query.get("status")?.trim();

  return terminals.filter((term) => {
    if (machine && machine !== "all") {
      if (terminalMachineName(term.address) !== machine) return false;
    }
    if (roomId && term.labels["linger.room"] !== roomId) return false;
    if (workItemId && term.labels["linger.work_item"] !== workItemId)
      return false;
    if (status) {
      const termStatus = terminalStatusWord(term) ?? term.state;
      if (termStatus !== status && term.state !== status) return false;
    }
    return true;
  });
}

function parseBooleanParam(value: string | null, fallback: boolean): boolean {
  if (value === null || value === "") return fallback;
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return fallback;
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Authenticated loopback HTTP + WebSocket bridge speaking `herdr-core`'s
 * JSON-RPC 2.0 and framed `terminal.attach` protocol directly over Unix socket
 * or `hc connect`. Gives Desktop WebView and LAN Mobile Companion sub-ms
 * direct terminal attach and control while keeping shared-core compatibility.
 */
export class HerdrCoreLocalBridge {
  readonly #options: HerdrCoreLocalBridgeOptions;
  readonly #token: string;
  readonly #maxPutBytes: number;
  readonly #sockets = new Set<Duplex>();
  readonly #activeSessions = new Set<{ close: () => void }>();
  #server: http.Server | undefined;
  #listenPort: number | undefined;
  #lastDetection: HerdrCoreDetection | undefined;

  constructor(options: HerdrCoreLocalBridgeOptions = {}) {
    this.#options = options;
    this.#token = options.token ?? randomBytes(32).toString("base64url");
    this.#maxPutBytes = options.maxPutBytes ?? MAX_HERDR_CORE_PUT_BYTES;
  }

  running(): boolean {
    return this.#server !== undefined && this.#listenPort !== undefined;
  }

  port(): number | undefined {
    return this.#listenPort;
  }

  token(): string {
    return this.#token;
  }

  async detect(): Promise<HerdrCoreDetection> {
    const detection = await detectHerdrCore(this.#options.detectorDeps);
    this.#lastDetection = detection;
    return detection;
  }

  async startServer(): Promise<HerdrCoreStartServerResult> {
    const result = await startHerdrCoreServer(this.#options.detectorDeps);
    this.#lastDetection = result.detection;
    return result;
  }

  async connectionInfo(): Promise<HerdrCoreBridgeConnectionInfo> {
    const detection = await this.detect();
    const port = this.#listenPort;
    return {
      running: port !== undefined,
      baseUrl:
        port !== undefined ? `http://127.0.0.1:${port}/herdr-core` : null,
      wsBaseUrl:
        port !== undefined ? `ws://127.0.0.1:${port}/herdr-core` : null,
      token: port !== undefined ? this.#token : null,
      detection,
    };
  }

  async start(): Promise<number> {
    if (this.#server && this.#listenPort !== undefined) {
      return this.#listenPort;
    }

    const server = http.createServer((req, res) => {
      void this.#handleLoopbackHttp(req, res).catch((error: unknown) => {
        this.#options.log?.warn("herdr_core.http_error", {
          error: String(error),
        });
        writeError(res, 500, "INTERNAL_ERROR", "Internal bridge error.");
      });
    });

    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });

    server.on("upgrade", (req, socket, head) => {
      this.#handleLoopbackUpgrade(req, socket, head);
    });

    const listenPort = this.#options.port ?? 0;
    const boundPort = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, "127.0.0.1", () => {
        server.off("error", reject);
        const addr = server.address() as AddressInfo | null;
        if (!addr) {
          reject(new Error("HerdrCoreLocalBridge bound without address"));
          return;
        }
        resolve(addr.port);
      });
    });

    this.#server = server;
    this.#listenPort = boundPort;
    this.#options.log?.info("herdr_core.bridge_started", {
      port: boundPort,
    });
    return boundPort;
  }

  async stop(): Promise<void> {
    for (const session of [...this.#activeSessions]) {
      this.#activeSessions.delete(session);
      try {
        session.close();
      } catch {
        // Ignore teardown errors.
      }
    }

    const server = this.#server;
    this.#server = undefined;
    this.#listenPort = undefined;
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
    this.#options.log?.info("herdr_core.bridge_stopped", {});
  }

  /**
   * Handles a pre-authenticated HTTP request delegated from CompanionGateway.
   */
  async handleDelegatedHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    subPath: string,
    search: string,
  ): Promise<void> {
    await this.#dispatchHttp(req, res, subPath, search, {});
  }

  /**
   * Handles a pre-authenticated WebSocket upgrade delegated from CompanionGateway.
   */
  handleDelegatedUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    subPath: string,
    search: string,
  ): void {
    this.#dispatchUpgrade(req, socket, head, subPath, search);
  }

  #corsHeadersForOrigin(
    origin: string | undefined,
  ): OutgoingHttpHeaders | null {
    if (!origin) return {};
    const allowed = this.#options.getAllowedOrigin?.();
    if (!allowed || !sameOrigin(origin, allowed)) {
      return null;
    }
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      vary: "origin",
    };
  }

  #authenticateToken(req: IncomingMessage, query: URLSearchParams): boolean {
    const auth = req.headers.authorization;
    if (typeof auth === "string") {
      const match = /^Bearer\s+(\S+)$/iu.exec(auth.trim());
      if (match?.[1] && constantTimeEquals(match[1], this.#token)) {
        return true;
      }
    }
    const queryToken = query.get("token");
    if (queryToken && constantTimeEquals(queryToken, this.#token)) {
      return true;
    }
    return false;
  }

  async #handleLoopbackHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const origin =
      typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const cors = this.#corsHeadersForOrigin(origin);
    if (cors === null) {
      writeError(res, 403, "FORBIDDEN_ORIGIN", "Origin is not permitted.");
      return;
    }

    if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "access-control-max-age": "600",
        "content-length": "0",
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!this.#authenticateToken(req, parsedUrl.searchParams)) {
      writeError(
        res,
        401,
        "UNAUTHORIZED",
        "Valid herdr-core bridge bearer token required.",
        cors,
      );
      return;
    }

    const subPath = extractSubPath(parsedUrl.pathname);
    if (!subPath) {
      writeError(res, 404, "NOT_FOUND", "Not found.", cors);
      return;
    }

    await this.#dispatchHttp(req, res, subPath, parsedUrl.search, cors);
  }

  #handleLoopbackUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const origin =
      typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (this.#corsHeadersForOrigin(origin) === null) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!this.#authenticateToken(req, parsedUrl.searchParams)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    const subPath = extractSubPath(parsedUrl.pathname);
    if (!subPath) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    this.#dispatchUpgrade(req, socket, head, subPath, parsedUrl.search);
  }

  async #resolveDialTarget(): Promise<{
    readonly target: HerdrCoreDialTarget;
    readonly detection: HerdrCoreDetection;
  }> {
    if (this.#options.dialTargetOverride) {
      const target = this.#options.dialTargetOverride();
      const detection: HerdrCoreDetection = this.#lastDetection ?? {
        installed: true,
        running: true,
        binaryPath: target.binaryPath ?? null,
        socketPath: target.socketPath ?? null,
        session: target.session ?? "default",
        platform: target.platform ?? process.platform,
        sharedCore: true,
        version: null,
        installHint: "",
      };
      return { target, detection };
    }
    const detection = await this.detect();
    return {
      detection,
      target: {
        socketPath: detection.socketPath,
        binaryPath: detection.binaryPath,
        session: detection.session,
        platform: detection.platform,
        env: this.#options.detectorDeps?.env as NodeJS.ProcessEnv | undefined,
      },
    };
  }

  async #dispatchHttp(
    req: IncomingMessage,
    res: ServerResponse,
    subPath: string,
    search: string,
    extraHeaders: OutgoingHttpHeaders,
  ): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const query = new URLSearchParams(search);

    if (subPath === "/status" && method === "GET") {
      await this.#handleStatus(res, extraHeaders);
      return;
    }

    const { target, detection } = await this.#resolveDialTarget();
    if (!this.#options.dialTargetOverride && !detection.running) {
      writeError(
        res,
        503,
        "HERDR_CORE_UNAVAILABLE",
        detection.installed
          ? "herdr-core is installed but not running."
          : detection.installHint,
        extraHeaders,
      );
      return;
    }

    try {
      if (subPath === "/terminals" && method === "GET") {
        const all = parseBooleanParam(query.get("all"), false);
        const list = await callHerdrCoreRpc<TerminalListRpcResult>(
          target,
          "terminal.list",
          { all },
        );
        const terminals = filterTerminalsList(list.terminals ?? [], query);
        writeJson(
          res,
          200,
          {
            terminals,
            machines: list.machines ?? [],
            hidden_finished: list.hidden_finished ?? 0,
          },
          extraHeaders,
        );
        return;
      }

      if (subPath === "/terminals" && method === "POST") {
        const body = await readJsonBody(req, DEFAULT_SMALL_JSON_BODY_BYTES);
        if (!body.ok) {
          writeError(res, body.status, body.code, body.message, extraHeaders);
          return;
        }
        const rpcParams: Record<string, unknown> = {};
        const b = body.data;
        if (Array.isArray(b.argv)) {
          rpcParams.argv = b.argv;
        } else if (typeof b.template === "string" && b.template.trim()) {
          rpcParams.argv =
            typeof b.task === "string" && b.task.trim()
              ? [b.template.trim(), b.task]
              : [b.template.trim()];
        }
        if (typeof b.line === "string" && b.line.trim())
          rpcParams.line = b.line;
        if (typeof b.name === "string" && b.name.trim())
          rpcParams.name = b.name.trim();
        if (typeof b.cwd === "string" && b.cwd.trim())
          rpcParams.cwd = b.cwd.trim();
        if (typeof b.on === "string" && b.on.trim() && b.on !== "local")
          rpcParams.on = b.on.trim();
        if (typeof b.keep === "boolean") rpcParams.keep = b.keep;
        if (
          b.labels &&
          typeof b.labels === "object" &&
          !Array.isArray(b.labels)
        )
          rpcParams.labels = b.labels;
        if (typeof b.parent === "string" && b.parent.trim())
          rpcParams.parent = b.parent.trim();
        if (typeof b.rm === "boolean") rpcParams.rm = b.rm;
        if (typeof b.no_notify === "boolean") rpcParams.no_notify = b.no_notify;
        if (b.size && typeof b.size === "object" && !Array.isArray(b.size))
          rpcParams.size = b.size;

        const created = await callHerdrCoreRpc(
          target,
          "terminal.run",
          rpcParams,
        );
        writeJson(res, 200, { terminal: created }, extraHeaders);
        return;
      }

      if (subPath === "/terminal" && method === "GET") {
        const address = query.get("address")?.trim();
        if (!address) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "Missing required query parameter: address.",
            extraHeaders,
          );
          return;
        }
        const terminal = await callHerdrCoreRpc(target, "terminal.get", {
          terminal: address,
        });
        writeJson(res, 200, { terminal }, extraHeaders);
        return;
      }

      if (subPath === "/terminal" && method === "DELETE") {
        const address = query.get("address")?.trim();
        if (!address) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "Missing required query parameter: address.",
            extraHeaders,
          );
          return;
        }
        await callHerdrCoreRpc(target, "terminal.rm", { terminal: address });
        writeJson(res, 200, { removed: true, address }, extraHeaders);
        return;
      }

      if (subPath === "/terminal/read" && method === "GET") {
        const address = query.get("address")?.trim();
        if (!address) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "Missing required query parameter: address.",
            extraHeaders,
          );
          return;
        }
        const lines = parsePositiveInt(query.get("lines"), 120, 0, 10_000);
        const readResult = await callHerdrCoreRpc(target, "terminal.read", {
          terminal: address,
          lines,
        });
        writeJson(res, 200, readResult, extraHeaders);
        return;
      }

      if (subPath === "/terminal/send" && method === "POST") {
        const body = await readJsonBody(req, DEFAULT_SMALL_JSON_BODY_BYTES);
        if (!body.ok) {
          writeError(res, body.status, body.code, body.message, extraHeaders);
          return;
        }
        const address =
          typeof body.data.address === "string" ? body.data.address.trim() : "";
        const text =
          typeof body.data.text === "string" ? body.data.text : undefined;
        if (!address || text === undefined) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "address and text are required.",
            extraHeaders,
          );
          return;
        }
        const params: Record<string, unknown> = {
          terminal: address,
          text,
        };
        const rawIf =
          typeof body.data.if === "string" ? body.data.if.trim() : "";
        if (rawIf === "idle" || rawIf === "working") {
          params.if = rawIf;
        } else if (
          rawIf === "blocked" ||
          rawIf === "done" ||
          rawIf === "error"
        ) {
          // herdr-core v0.1.21 only accepts `if: "idle" | "working"` on
          // `terminal.send` (other values fail with -32602 invalid_params).
          // Verify live terminal status via `terminal.get` first, then send
          // without `if`.
          const current = await callHerdrCoreRpc<HerdrCoreTerminal>(
            target,
            "terminal.get",
            { terminal: address },
          );
          if (current.state !== "live") {
            writeError(
              res,
              410,
              "FINISHED",
              `Terminal "${address}" is not live (state: ${current.state}).`,
              extraHeaders,
            );
            return;
          }
          const actualStatus = terminalStatusWord(current);
          if (actualStatus !== rawIf) {
            writeError(
              res,
              409,
              "CONFLICT",
              `Terminal "${address}" status is "${actualStatus ?? "none"}", expected "${rawIf}".`,
              extraHeaders,
            );
            return;
          }
          if (rawIf === "blocked" && body.data.force === undefined) {
            params.force = true;
          }
        } else if (rawIf.length > 0) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            `Unsupported "if" status filter: ${rawIf}.`,
            extraHeaders,
          );
          return;
        }
        if (typeof body.data.force === "boolean")
          params.force = body.data.force;
        if (typeof body.data.wait === "boolean") params.wait = body.data.wait;
        if (typeof body.data.timeout === "number")
          params.timeout = body.data.timeout;

        const result = await callHerdrCoreRpc(target, "terminal.send", params);
        writeJson(res, 200, result, extraHeaders);
        return;
      }

      if (subPath === "/terminal/keys" && method === "POST") {
        const body = await readJsonBody(req, DEFAULT_SMALL_JSON_BODY_BYTES);
        if (!body.ok) {
          writeError(res, body.status, body.code, body.message, extraHeaders);
          return;
        }
        const address =
          typeof body.data.address === "string" ? body.data.address.trim() : "";
        const keys = Array.isArray(body.data.keys)
          ? body.data.keys.filter((k): k is string => typeof k === "string")
          : [];
        if (!address || keys.length === 0) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "address and non-empty keys array are required.",
            extraHeaders,
          );
          return;
        }
        const result = await callHerdrCoreRpc(target, "terminal.keys", {
          terminal: address,
          keys,
        });
        writeJson(res, 200, result, extraHeaders);
        return;
      }

      if (subPath === "/terminal/interrupt" && method === "POST") {
        const body = await readJsonBody(req, DEFAULT_SMALL_JSON_BODY_BYTES);
        if (!body.ok) {
          writeError(res, body.status, body.code, body.message, extraHeaders);
          return;
        }
        const address =
          typeof body.data.address === "string" ? body.data.address.trim() : "";
        if (!address) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "address is required.",
            extraHeaders,
          );
          return;
        }
        const params: Record<string, unknown> = { terminal: address };
        if (typeof body.data.timeout === "number")
          params.timeout = body.data.timeout;
        const result = await callHerdrCoreRpc(
          target,
          "terminal.interrupt",
          params,
        );
        writeJson(res, 200, result, extraHeaders);
        return;
      }

      if (subPath === "/terminal/kill" && method === "POST") {
        const body = await readJsonBody(req, DEFAULT_SMALL_JSON_BODY_BYTES);
        if (!body.ok) {
          writeError(res, body.status, body.code, body.message, extraHeaders);
          return;
        }
        const address =
          typeof body.data.address === "string" ? body.data.address.trim() : "";
        if (!address) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "address is required.",
            extraHeaders,
          );
          return;
        }
        const result = await callHerdrCoreRpc(target, "terminal.kill", {
          terminal: address,
        });
        writeJson(res, 200, result, extraHeaders);
        return;
      }

      if (subPath === "/terminal/label" && method === "POST") {
        const body = await readJsonBody(req, DEFAULT_SMALL_JSON_BODY_BYTES);
        if (!body.ok) {
          writeError(res, body.status, body.code, body.message, extraHeaders);
          return;
        }
        const address =
          typeof body.data.address === "string" ? body.data.address.trim() : "";
        const labels = body.data.labels;
        if (
          !address ||
          !labels ||
          typeof labels !== "object" ||
          Array.isArray(labels)
        ) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "address and labels object are required.",
            extraHeaders,
          );
          return;
        }
        const result = await callHerdrCoreRpc(target, "terminal.label", {
          terminal: address,
          labels,
        });
        writeJson(res, 200, result, extraHeaders);
        return;
      }

      if (subPath === "/terminal/put" && method === "POST") {
        const bodyLimit = Math.max(
          DEFAULT_MAX_JSON_BODY_BYTES,
          Math.ceil(this.#maxPutBytes * 1.4) + 64 * 1024,
        );
        const body = await readJsonBody(req, bodyLimit);
        if (!body.ok) {
          writeError(res, body.status, body.code, body.message, extraHeaders);
          return;
        }
        const address =
          typeof body.data.address === "string" ? body.data.address.trim() : "";
        const safeName = validatePutFilename(body.data.name);
        if (!address || !safeName) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "Valid address and safe filename are required.",
            extraHeaders,
          );
          return;
        }
        const validated = decodeAndValidatePutBase64(
          body.data.data_base64,
          this.#maxPutBytes,
        );
        if (!validated.ok) {
          writeError(
            res,
            validated.status,
            validated.code,
            validated.message,
            extraHeaders,
          );
          return;
        }
        const result = await callHerdrCoreRpc<PutRpcResult>(
          target,
          "terminal.put",
          {
            terminal: address,
            name: safeName,
            data: validated.normalized,
          },
        );
        writeJson(
          res,
          200,
          {
            path: result.path ?? "",
            name: safeName,
            bytes: validated.bytes,
          },
          extraHeaders,
        );
        return;
      }

      if (subPath === "/templates" && method === "GET") {
        const result = await callHerdrCoreRpc<TemplatesListRpcResult>(
          target,
          "templates.list",
          {},
        );
        writeJson(
          res,
          200,
          { templates: result.templates ?? [] },
          extraHeaders,
        );
        return;
      }

      if (subPath === "/machines" && method === "GET") {
        const result = await callHerdrCoreRpc<MachineListRpcResult>(
          target,
          "machine.list",
          {},
        );
        writeJson(res, 200, { machines: result.machines ?? [] }, extraHeaders);
        return;
      }

      if (subPath.startsWith("/docs/")) {
        const rawName = subPath.slice("/docs/".length);
        let docName: string;
        try {
          docName = decodeURIComponent(rawName).trim();
        } catch {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "Invalid doc name.",
            extraHeaders,
          );
          return;
        }
        if (!docName || docName.includes("/")) {
          writeError(
            res,
            400,
            "INVALID_REQUEST",
            "Invalid doc name.",
            extraHeaders,
          );
          return;
        }
        const on = query.get("on")?.trim() || undefined;

        if (method === "GET") {
          const result = await callHerdrCoreRpc<DocGetRpcResult>(
            target,
            "doc.get",
            {
              name: docName,
              ...(on && on !== "local" ? { on } : {}),
            },
          );
          writeJson(res, 200, result, extraHeaders);
          return;
        }

        if (method === "PUT") {
          const body = await readJsonBody(
            req,
            MAX_HERDR_CORE_DOC_BYTES + 16_384,
          );
          if (!body.ok) {
            writeError(res, body.status, body.code, body.message, extraHeaders);
            return;
          }
          const value = "value" in body.data ? body.data.value : body.data;
          const serialized = JSON.stringify(value);
          if (
            Buffer.byteLength(serialized, "utf8") > MAX_HERDR_CORE_DOC_BYTES
          ) {
            writeError(
              res,
              413,
              "PAYLOAD_TOO_LARGE",
              `Document exceeds maximum size of ${MAX_HERDR_CORE_DOC_BYTES} bytes.`,
              extraHeaders,
            );
            return;
          }
          let version =
            typeof body.data.version === "number" &&
            Number.isInteger(body.data.version) &&
            body.data.version >= 0
              ? body.data.version
              : undefined;
          if (version === undefined) {
            const current = await callHerdrCoreRpc<DocGetRpcResult>(
              target,
              "doc.get",
              {
                name: docName,
                ...(on && on !== "local" ? { on } : {}),
              },
            );
            version = current.version;
          }
          const result = await callHerdrCoreRpc(target, "doc.set", {
            name: docName,
            value,
            version,
            ...(on && on !== "local" ? { on } : {}),
          });
          writeJson(res, 200, result, extraHeaders);
          return;
        }
      }

      writeError(res, 404, "NOT_FOUND", "Not found.", extraHeaders);
    } catch (error) {
      const mapped = mapRpcError(error);
      writeError(res, mapped.status, mapped.code, mapped.message, extraHeaders);
    }
  }

  async #handleStatus(
    res: ServerResponse,
    extraHeaders: OutgoingHttpHeaders,
  ): Promise<void> {
    const { target, detection } = await this.#resolveDialTarget();
    if (!this.#options.dialTargetOverride && !detection.running) {
      const payload: HerdrCoreStatusPayload = {
        available: false,
        version: detection.version,
        core_id: null,
        core_name: null,
        pid: null,
        uptime_ms: null,
        live_count: 0,
        finished_count: 0,
        blocked_count: 0,
        working_count: 0,
        machines: [],
        shared_core: detection.sharedCore,
        socket_path: detection.socketPath,
        binary_path: detection.binaryPath,
      };
      writeJson(res, 200, payload, extraHeaders);
      return;
    }

    try {
      const [statusResult, listResult] = await Promise.all([
        callHerdrCoreRpc<ServerStatusRpcResult>(target, "server.status", {}),
        callHerdrCoreRpc<TerminalListRpcResult>(target, "terminal.list", {
          all: true,
        }),
      ]);
      const terminals = listResult.terminals ?? [];
      let liveCount = 0;
      let finishedCount = 0;
      let blockedCount = 0;
      let workingCount = 0;
      for (const term of terminals) {
        if (term.state === "live") {
          liveCount += 1;
          const word = terminalStatusWord(term);
          if (word === "blocked") blockedCount += 1;
          else if (word === "working") workingCount += 1;
        } else {
          finishedCount += 1;
        }
      }

      const payload: HerdrCoreStatusPayload = {
        available: true,
        version: statusResult.version ?? detection.version,
        core_id: statusResult.core?.id ?? null,
        core_name: statusResult.core?.name ?? null,
        pid: statusResult.pid ?? null,
        uptime_ms: statusResult.uptime_ms ?? null,
        live_count:
          statusResult.live ?? statusResult.terminals?.live ?? liveCount,
        finished_count:
          statusResult.finished ??
          statusResult.terminals?.finished ??
          finishedCount,
        blocked_count: blockedCount,
        working_count: workingCount,
        machines: listResult.machines ?? [],
        shared_core: detection.sharedCore,
        socket_path: detection.socketPath,
        binary_path: detection.binaryPath,
      };
      writeJson(res, 200, payload, extraHeaders);
    } catch {
      const payload: HerdrCoreStatusPayload = {
        available: false,
        version: detection.version,
        core_id: null,
        core_name: null,
        pid: null,
        uptime_ms: null,
        live_count: 0,
        finished_count: 0,
        blocked_count: 0,
        working_count: 0,
        machines: [],
        shared_core: detection.sharedCore,
        socket_path: detection.socketPath,
        binary_path: detection.binaryPath,
      };
      writeJson(res, 200, payload, extraHeaders);
    }
  }

  #dispatchUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    subPath: string,
    search: string,
  ): void {
    if (subPath !== "/attach") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const query = new URLSearchParams(search);
    const address = query.get("address")?.trim();
    if (!address) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    const initialCols = parsePositiveInt(query.get("cols"), 100, 10, 500);
    const initialRows = parsePositiveInt(query.get("rows"), 32, 4, 200);
    const initialObserve = parseBooleanParam(query.get("observe"), true);
    const history = parsePositiveInt(query.get("history"), 200, 0, 5_000);
    const resumed = parseBooleanParam(query.get("resumed"), false);

    let activeChannel: number | null = null;
    let observe = initialObserve;
    let cols = initialCols;
    let rows = initialRows;
    let switchingMode = false;
    let framedSession: HerdrCoreFramedSession | null = null;
    let ws: WebSocketServerConnection | null = null;
    let tornDown = false;

    const sessionHandle = {
      close: () => teardown(),
    };

    const teardown = (): void => {
      if (tornDown) return;
      tornDown = true;
      this.#activeSessions.delete(sessionHandle);
      if (framedSession) {
        if (activeChannel !== null) {
          framedSession.sendCloseChannel(activeChannel);
        }
        framedSession.close();
        framedSession = null;
      }
      if (ws && !ws.closed) {
        ws.close(1000, "Closed");
      }
    };

    const sendWsJson = (payload: Record<string, unknown>): void => {
      ws?.sendText(JSON.stringify(payload));
    };

    const attachOnSession = async (
      session: HerdrCoreFramedSession,
      params: {
        readonly nextObserve: boolean;
        readonly nextCols: number;
        readonly nextRows: number;
        readonly isResumed: boolean;
      },
    ): Promise<void> => {
      const result = await session.call<AttachRpcResult>("terminal.attach", {
        terminal: address,
        cols: params.nextCols,
        rows: params.nextRows,
        observe: params.nextObserve,
        history: params.isResumed ? 0 : history,
        resumed: params.isResumed,
        resize_notifications: true,
      });
      if (tornDown) {
        session.sendCloseChannel(result.channel);
        return;
      }
      activeChannel = result.channel;
      observe = params.nextObserve;
      cols = result.terminal?.cols ?? params.nextCols;
      rows = result.terminal?.rows ?? params.nextRows;
      sendWsJson({
        type: "attached",
        terminal: result.terminal,
        cols,
        rows,
        observe,
        resize_notifications: Boolean(result.resize_notifications),
        automatic_input: Boolean(result.automatic_input),
      });
    };

    const maxWsBytes = Math.max(
      DEFAULT_MAX_JSON_BODY_BYTES,
      Math.ceil(this.#maxPutBytes * 1.4) + 64 * 1024,
    );

    ws = acceptWebSocket(
      req,
      socket,
      head,
      {
        onBinary: (data) => {
          if (tornDown || !framedSession || activeChannel === null) return;
          if (observe) {
            sendWsJson({
              type: "error",
              code: "OBSERVE_ONLY",
              message:
                "Terminal is in observe mode; switch to interactive mode to type.",
            });
            return;
          }
          framedSession.sendData(activeChannel, data);
        },
        onText: (text) => {
          if (tornDown) return;
          let message: Record<string, unknown>;
          try {
            const parsed = JSON.parse(text) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              return;
            message = parsed as Record<string, unknown>;
          } catch {
            sendWsJson({
              type: "error",
              code: "INVALID_MESSAGE",
              message: "Control frames must be valid JSON objects.",
            });
            return;
          }

          const type = message.type;
          if (type === "ping") {
            sendWsJson({ type: "pong" });
            return;
          }

          if (type === "resize") {
            if (observe) {
              sendWsJson({
                type: "error",
                code: "OBSERVE_ONLY",
                message: "Cannot resize terminal while in observe mode.",
              });
              return;
            }
            const nextCols =
              typeof message.cols === "number"
                ? Math.max(10, Math.min(500, Math.trunc(message.cols)))
                : cols;
            const nextRows =
              typeof message.rows === "number"
                ? Math.max(4, Math.min(200, Math.trunc(message.rows)))
                : rows;
            cols = nextCols;
            rows = nextRows;
            if (framedSession && activeChannel !== null) {
              framedSession.sendResize(activeChannel, cols, rows);
            }
            return;
          }

          if (type === "mode") {
            if (typeof message.observe !== "boolean") {
              sendWsJson({
                type: "error",
                code: "INVALID_MESSAGE",
                message: "mode message requires boolean observe field.",
              });
              return;
            }
            const nextObserve = message.observe;
            const nextCols =
              typeof message.cols === "number"
                ? Math.max(10, Math.min(500, Math.trunc(message.cols)))
                : cols;
            const nextRows =
              typeof message.rows === "number"
                ? Math.max(4, Math.min(200, Math.trunc(message.rows)))
                : rows;
            if (!framedSession) return;
            if (nextObserve === observe) {
              sendWsJson({ type: "attached", cols, rows, observe });
              return;
            }
            const session = framedSession;
            const previousChannel = activeChannel;
            switchingMode = true;
            activeChannel = null;
            if (previousChannel !== null) {
              session.sendCloseChannel(previousChannel);
            }
            void attachOnSession(session, {
              nextObserve,
              nextCols,
              nextRows,
              isResumed: true,
            })
              .catch((error: unknown) => {
                const mapped = mapRpcError(error);
                sendWsJson({
                  type: "error",
                  code: mapped.code,
                  message: mapped.message,
                });
              })
              .finally(() => {
                switchingMode = false;
              });
            return;
          }

          if (type === "put") {
            if (!framedSession) return;
            const safeName = validatePutFilename(message.name);
            if (!safeName) {
              sendWsJson({
                type: "error",
                code: "INVALID_REQUEST",
                message: "Valid safe filename is required for put.",
              });
              return;
            }
            const validated = decodeAndValidatePutBase64(
              message.data_base64,
              this.#maxPutBytes,
            );
            if (!validated.ok) {
              sendWsJson({
                type: "error",
                code: validated.code,
                message: validated.message,
              });
              return;
            }
            void framedSession
              .call<PutRpcResult>("terminal.put", {
                terminal: address,
                name: safeName,
                data: validated.normalized,
              })
              .then((resPut) => {
                sendWsJson({
                  type: "put_result",
                  path: resPut.path ?? "",
                  name: safeName,
                  bytes: validated.bytes,
                });
              })
              .catch((error: unknown) => {
                const mapped = mapRpcError(error);
                sendWsJson({
                  type: "error",
                  code: mapped.code,
                  message: mapped.message,
                });
              });
          }
        },
        onClose: () => teardown(),
        onError: () => teardown(),
      },
      { maxMessageBytes: maxWsBytes },
    );

    if (!ws) return;
    this.#activeSessions.add(sessionHandle);

    void (async () => {
      try {
        const { target } = await this.#resolveDialTarget();
        const { session } = await HerdrCoreFramedSession.connect(target, {
          onFrame: (frame) => {
            if (tornDown || frame.channel !== activeChannel) return;
            if (frame.kind === FrameKind.DATA) {
              if (frame.payload.length > 0) {
                ws?.sendBinary(frame.payload);
                session.sendCredit(frame.channel, frame.payload.length);
              }
            } else if (frame.kind === FrameKind.RESIZE) {
              const size = decodeResizePayload(frame.payload);
              if (size) {
                cols = size.cols;
                rows = size.rows;
                sendWsJson({
                  type: "resize",
                  cols: size.cols,
                  rows: size.rows,
                });
              }
            } else if (frame.kind === FrameKind.FACTS) {
              try {
                const facts = JSON.parse(
                  frame.payload.toString("utf8"),
                ) as Record<string, unknown>;
                sendWsJson({ type: "status", ...facts });
              } catch {
                // Ignore non-JSON facts payload.
              }
            } else if (frame.kind === FrameKind.CLOSE) {
              if (!switchingMode) {
                activeChannel = null;
                sendWsJson({ type: "closed", reason: "terminal_closed" });
                teardown();
              }
            }
          },
          onClose: () => {
            if (!tornDown) {
              sendWsJson({ type: "closed", reason: "core_disconnected" });
              teardown();
            }
          },
        });
        if (tornDown) {
          session.close();
          return;
        }
        framedSession = session;
        await attachOnSession(session, {
          nextObserve: initialObserve,
          nextCols: initialCols,
          nextRows: initialRows,
          isResumed: resumed,
        });
      } catch (error) {
        const mapped = mapRpcError(error);
        sendWsJson({
          type: "error",
          code: mapped.code,
          message: mapped.message,
        });
        teardown();
      }
    })();
  }
}
