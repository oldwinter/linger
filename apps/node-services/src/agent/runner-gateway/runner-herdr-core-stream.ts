import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import WebSocket, { WebSocketServer, type RawData } from "ws";
import { isRecord } from "@linger/service-kit";

import { logAgentEvent } from "../observability/agent-log.js";
import type { RunnerCredentialAuthenticator } from "./runner-credential-authority.js";
import {
  LocalComputerNotFoundError,
  LocalComputerOfflineError,
} from "./local-computer-management.js";
import {
  HERDR_CORE_ATTACH_TOOL_NAME,
  HerdrCoreUnsupportedError,
  type OwnerHerdrCoreCallRequest,
} from "./runner-herdr-core.js";
import { CredentialCatalog } from "./runner-gateway-websocket.js";

/** Dedicated WebSocket endpoint where Local Computer Daemons attach binary PTY streams. */
export const HERDR_CORE_DAEMON_STREAM_PATH =
  "/v1/runner-gateway/herdr-core-stream";

/** Dedicated WebSocket endpoint for authenticated browser/mobile PTY attach clients. */
export const HERDR_CORE_CLIENT_ATTACH_PATH = "/v1/herdr-core/attach";

const ATTACH_TOKEN_DOMAIN = "herdr-core-attach-v1";
const MAX_ATTACH_TOKEN_TTL_SECONDS = 120;
const DEFAULT_DAEMON_JOIN_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_SESSIONS = 64;
const DEFAULT_CLIENT_HIGH_WATER_BYTES = 1 * 1024 * 1024;
const DEFAULT_CLIENT_HARD_LIMIT_BYTES = 4 * 1024 * 1024;
const DEFAULT_DAEMON_HARD_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_STREAM_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_PUT_BASE64_LENGTH = 1_500_000;
const DRAIN_POLL_INTERVAL_MS = 25;
const DAEMON_CONTROL_TYPES = new Set([
  "attached",
  "resize",
  "status",
  "put_result",
  "closed",
  "error",
  "pong",
]);

/** Claims signed into a short-lived TeamHub-minted attach token. */
export interface HerdrCoreAttachTokenClaims {
  readonly v: 1;
  readonly session_id: string;
  readonly computer_id: string;
  readonly tenant_id: string;
  readonly owner_actor_id: string;
  readonly address: string;
  readonly cols: number;
  readonly rows: number;
  readonly observe: boolean;
  readonly history: number;
  readonly resumed?: boolean;
  readonly exp: number;
}

export interface HerdrCoreStreamGatewayPort {
  supportsHerdrCore(computerId: string): boolean;
  servingOwnerConnectionEpoch(
    computerId: string,
    tenantId: string,
    ownerActorId: string,
  ): number | undefined;
  callHerdrCore(
    request: OwnerHerdrCoreCallRequest,
  ): Promise<Record<string, unknown>>;
  onHerdrCoreComputerDisconnected(
    listener: (computerId: string) => void,
  ): () => void;
}

export interface AttachHerdrCoreStreamRelayOptions {
  readonly server: Server;
  readonly gateway: HerdrCoreStreamGatewayPort;
  readonly credentialAuthenticators: readonly RunnerCredentialAuthenticator[];
  /** Shared HMAC key used by TeamHub to sign attach tokens. */
  readonly attachTokenSigningKey: string;
  readonly daemonPath?: string;
  readonly clientPath?: string;
  readonly daemonJoinTimeoutMs?: number;
  readonly maxSessions?: number;
  readonly clientHighWaterBytes?: number;
  readonly clientHardLimitBytes?: number;
}

export interface HerdrCoreStreamRelayHandle {
  close(): Promise<void>;
  activeSessionCount(): number;
}

/** Signs attach claims into a compact base64url HMAC-SHA256 token. */
export function signHerdrCoreAttachToken(
  claims: HerdrCoreAttachTokenClaims,
  signingKey: string,
): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", signingKey)
    .update(`${ATTACH_TOKEN_DOMAIN}\n${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/** Verifies a TeamHub-signed attach token and returns validated claims, or null. */
export function verifyHerdrCoreAttachToken(
  token: string | undefined,
  signingKey: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): HerdrCoreAttachTokenClaims | null {
  if (!token || !signingKey) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", signingKey)
    .update(`${ATTACH_TOKEN_DOMAIN}\n${payload}`)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isValidAttachClaims(parsed)) return null;
  if (
    parsed.exp <= nowSeconds ||
    parsed.exp > nowSeconds + MAX_ATTACH_TOKEN_TTL_SECONDS + 30
  ) {
    return null;
  }
  return parsed;
}

/**
 * Attaches the independent binary PTY WebSocket relay to an HTTP server:
 * - `/v1/runner-gateway/herdr-core-stream` accepts outbound Daemon stream sessions.
 * - `/v1/herdr-core/attach` accepts authenticated client attach sessions.
 */
export function attachHerdrCoreStreamRelay(
  options: AttachHerdrCoreStreamRelayOptions,
): HerdrCoreStreamRelayHandle {
  const daemonPath = options.daemonPath ?? HERDR_CORE_DAEMON_STREAM_PATH;
  const clientPath = options.clientPath ?? HERDR_CORE_CLIENT_ATTACH_PATH;
  const daemonJoinTimeoutMs =
    options.daemonJoinTimeoutMs ?? DEFAULT_DAEMON_JOIN_TIMEOUT_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const clientHighWaterBytes =
    options.clientHighWaterBytes ?? DEFAULT_CLIENT_HIGH_WATER_BYTES;
  const clientHardLimitBytes =
    options.clientHardLimitBytes ?? DEFAULT_CLIENT_HARD_LIMIT_BYTES;

  const credentials = new CredentialCatalog(options.credentialAuthenticators);
  const daemonWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_STREAM_FRAME_BYTES,
    perMessageDeflate: false,
  });
  const clientWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_STREAM_FRAME_BYTES,
    perMessageDeflate: false,
  });

  const sessions = new Map<string, AttachRelaySession>();
  const consumedSessionExpiries = new Map<string, number>();
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const pruneConsumed = (nowSeconds: number): void => {
    for (const [sessionId, exp] of consumedSessionExpiries) {
      if (exp <= nowSeconds) consumedSessionExpiries.delete(sessionId);
    }
  };

  const unsubscribeDisconnect = options.gateway.onHerdrCoreComputerDisconnected(
    (computerId) => {
      for (const session of [...sessions.values()]) {
        if (session.claims.computer_id === computerId) {
          session.closeWithReason("computer_disconnected");
        }
      }
    },
  );

  const onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url ?? "", "http://agent.local");
    } catch {
      return;
    }
    if (parsedUrl.pathname === daemonPath) {
      void handleDaemonUpgrade(request, parsedUrl, socket, head).catch(() => {
        rejectHttpUpgrade(socket, 503, "Service Unavailable");
      });
      return;
    }
    if (parsedUrl.pathname === clientPath) {
      void handleClientUpgrade(request, parsedUrl, socket, head).catch(() => {
        rejectHttpUpgrade(socket, 503, "Service Unavailable");
      });
    }
  };

  const handleDaemonUpgrade = async (
    request: IncomingMessage,
    parsedUrl: URL,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> => {
    if (closed) {
      rejectHttpUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    const sessionId = parsedUrl.searchParams.get("session_id")?.trim() ?? "";
    if (!sessionId) {
      rejectHttpUpgrade(socket, 400, "Bad Request");
      return;
    }
    const auth = await credentials.authenticate(request.headers.authorization);
    if (auth.status === "unavailable") {
      rejectHttpUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    if (!auth.credential) {
      rejectHttpUpgrade(socket, 401, "Unauthorized", {
        "WWW-Authenticate": "Bearer",
      });
      return;
    }
    const session = sessions.get(sessionId);
    if (
      !session ||
      session.hasDaemon() ||
      session.claims.computer_id !== auth.credential.runnerId
    ) {
      rejectHttpUpgrade(socket, 404, "Not Found");
      return;
    }
    const epochParam = parsedUrl.searchParams.get("connection_epoch");
    if (epochParam !== null) {
      const epoch = Number(epochParam);
      if (!Number.isSafeInteger(epoch) || epoch !== session.connectionEpoch) {
        rejectHttpUpgrade(socket, 409, "Conflict");
        return;
      }
    }
    daemonWss.handleUpgrade(request, socket, head, (daemonWs) => {
      if (closed || !sessions.has(sessionId) || session.hasDaemon()) {
        daemonWs.close(1008, "Session is no longer waiting");
        return;
      }
      session.attachDaemon(daemonWs);
    });
  };

  const handleClientUpgrade = async (
    request: IncomingMessage,
    parsedUrl: URL,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> => {
    if (closed) {
      rejectHttpUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    const rawToken =
      parsedUrl.searchParams.get("token")?.trim() ||
      readBearerHeader(request.headers.authorization) ||
      readHeaderString(request.headers["x-herdr-core-attach-token"]);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    pruneConsumed(nowSeconds);
    const claims = verifyHerdrCoreAttachToken(
      rawToken,
      options.attachTokenSigningKey,
      nowSeconds,
    );
    if (!claims) {
      rejectHttpUpgrade(socket, 401, "Unauthorized");
      return;
    }
    if (
      consumedSessionExpiries.has(claims.session_id) ||
      sessions.has(claims.session_id)
    ) {
      rejectHttpUpgrade(socket, 409, "Conflict");
      return;
    }
    if (sessions.size >= maxSessions) {
      rejectHttpUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    const connectionEpoch = options.gateway.servingOwnerConnectionEpoch(
      claims.computer_id,
      claims.tenant_id,
      claims.owner_actor_id,
    );
    if (connectionEpoch === undefined) {
      rejectHttpUpgrade(socket, 409, "Conflict");
      return;
    }
    if (!options.gateway.supportsHerdrCore(claims.computer_id)) {
      rejectHttpUpgrade(socket, 409, "Conflict");
      return;
    }
    consumedSessionExpiries.set(claims.session_id, claims.exp);

    clientWss.handleUpgrade(request, socket, head, (clientWs) => {
      const session = new AttachRelaySession({
        claims,
        connectionEpoch,
        clientWs,
        daemonPath,
        gateway: options.gateway,
        daemonJoinTimeoutMs,
        clientHighWaterBytes,
        clientHardLimitBytes,
        onClosed: () => {
          sessions.delete(claims.session_id);
        },
      });
      sessions.set(claims.session_id, session);
      session.start();
    });
  };

  options.server.on("upgrade", onUpgrade);

  return {
    activeSessionCount: () => sessions.size,
    close: () => {
      closePromise ??= (async () => {
        closed = true;
        options.server.off("upgrade", onUpgrade);
        unsubscribeDisconnect();
        for (const session of [...sessions.values()]) {
          session.closeWithReason("server_shutdown");
        }
        sessions.clear();
        await Promise.all([
          new Promise<void>((resolve) => daemonWss.close(() => resolve())),
          new Promise<void>((resolve) => clientWss.close(() => resolve())),
        ]);
      })();
      return closePromise;
    },
  };
}

class AttachRelaySession {
  readonly claims: HerdrCoreAttachTokenClaims;
  readonly connectionEpoch: number;
  readonly #clientWs: WebSocket;
  readonly #daemonPath: string;
  readonly #gateway: HerdrCoreStreamGatewayPort;
  readonly #daemonJoinTimeoutMs: number;
  readonly #clientHighWaterBytes: number;
  readonly #clientHardLimitBytes: number;
  readonly #onClosed: () => void;
  readonly #abort = new AbortController();

  #daemonWs?: WebSocket;
  #observe: boolean;
  #cols: number;
  #rows: number;
  #attachedSent = false;
  #closed = false;
  #daemonPaused = false;
  #joinTimer?: ReturnType<typeof setTimeout>;
  #drainTimer?: ReturnType<typeof setInterval>;

  constructor(options: {
    readonly claims: HerdrCoreAttachTokenClaims;
    readonly connectionEpoch: number;
    readonly clientWs: WebSocket;
    readonly daemonPath: string;
    readonly gateway: HerdrCoreStreamGatewayPort;
    readonly daemonJoinTimeoutMs: number;
    readonly clientHighWaterBytes: number;
    readonly clientHardLimitBytes: number;
    readonly onClosed: () => void;
  }) {
    this.claims = options.claims;
    this.connectionEpoch = options.connectionEpoch;
    this.#clientWs = options.clientWs;
    this.#daemonPath = options.daemonPath;
    this.#gateway = options.gateway;
    this.#daemonJoinTimeoutMs = options.daemonJoinTimeoutMs;
    this.#clientHighWaterBytes = options.clientHighWaterBytes;
    this.#clientHardLimitBytes = options.clientHardLimitBytes;
    this.#onClosed = options.onClosed;
    this.#observe = options.claims.observe;
    this.#cols = options.claims.cols;
    this.#rows = options.claims.rows;
  }

  hasDaemon(): boolean {
    return this.#daemonWs !== undefined;
  }

  start(): void {
    this.#clientWs.on("message", (data, isBinary) => {
      this.#handleClientMessage(data, isBinary);
    });
    this.#clientWs.once("close", () => this.#teardown("client_closed"));
    this.#clientWs.once("error", () => this.#teardown("client_error"));

    this.#joinTimer = setTimeout(() => {
      if (!this.#daemonWs && !this.#closed) {
        this.#sendClientControl({
          type: "error",
          code: "ATTACH_TIMEOUT",
          message: "Timed out waiting for Computer PTY stream to connect",
        });
        this.closeWithReason("attach_timeout");
      }
    }, this.#daemonJoinTimeoutMs);
    this.#joinTimer.unref();

    void this.#requestDaemonAttach();
  }

  attachDaemon(daemonWs: WebSocket): void {
    if (this.#closed) {
      daemonWs.close(1000, "Client already closed");
      return;
    }
    this.#clearJoinTimer();
    this.#daemonWs = daemonWs;
    daemonWs.on("message", (data, isBinary) => {
      this.#handleDaemonMessage(data, isBinary);
    });
    daemonWs.once("close", () => this.closeWithReason("daemon_closed"));
    daemonWs.once("error", () => this.closeWithReason("daemon_error"));
  }

  closeWithReason(reason: string): void {
    if (this.#closed) return;
    this.#sendClientControl({ type: "closed", reason });
    this.#teardown(reason);
  }

  async #requestDaemonAttach(): Promise<void> {
    try {
      const result = await this.#gateway.callHerdrCore({
        tenantId: this.claims.tenant_id,
        ownerActorId: this.claims.owner_actor_id,
        computerId: this.claims.computer_id,
        toolName: HERDR_CORE_ATTACH_TOOL_NAME,
        allowAttach: true,
        toolSessionId: `attach-${this.claims.session_id}`,
        arguments: {
          session_id: this.claims.session_id,
          stream_path: this.#daemonPath,
          address: this.claims.address,
          cols: this.#cols,
          rows: this.#rows,
          observe: this.#observe,
          history: this.claims.history,
          resumed: Boolean(this.claims.resumed),
          resize_notifications: true,
        },
        deadlineMs: this.#daemonJoinTimeoutMs,
        signal: this.#abort.signal,
      });
      if (this.#closed) return;
      const status = typeof result.status === "string" ? result.status : "";
      if (status && status !== "accepted" && status !== "ok") {
        const detail =
          typeof result.detail === "string" && result.detail.trim()
            ? result.detail
            : `Computer rejected attach request (${status})`;
        this.#sendClientControl({
          type: "error",
          code: status.toUpperCase(),
          message: detail,
        });
        this.closeWithReason(status);
      }
    } catch (error) {
      if (this.#closed) return;
      const code =
        error instanceof LocalComputerOfflineError
          ? "COMPUTER_OFFLINE"
          : error instanceof LocalComputerNotFoundError
            ? "COMPUTER_NOT_FOUND"
            : error instanceof HerdrCoreUnsupportedError
              ? "HERDR_CORE_UNSUPPORTED"
              : "ATTACH_FAILED";
      const message =
        error instanceof Error ? error.message : "Failed to start PTY attach";
      this.#sendClientControl({ type: "error", code, message });
      this.closeWithReason(code.toLowerCase());
    }
  }

  #handleClientMessage(data: RawData, isBinary: boolean): void {
    if (this.#closed) return;
    if (isBinary) {
      if (this.#observe) {
        this.#sendClientControl({
          type: "error",
          code: "OBSERVE_ONLY",
          message:
            "Attach session is in observe-only mode; send {type:'mode',observe:false} to interact",
        });
        return;
      }
      if (!this.#daemonWs || this.#daemonWs.readyState !== WebSocket.OPEN) {
        this.#sendClientControl({
          type: "error",
          code: "SESSION_NOT_READY",
          message: "Terminal stream is not yet connected",
        });
        return;
      }
      if (this.#daemonWs.bufferedAmount >= DEFAULT_DAEMON_HARD_LIMIT_BYTES) {
        this.#sendClientControl({
          type: "error",
          code: "DAEMON_BACKPRESSURE",
          message: "Terminal input buffer is full",
        });
        return;
      }
      this.#daemonWs.send(rawDataToBuffer(data), { binary: true });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToBuffer(data).toString("utf8"));
    } catch {
      this.#sendClientControl({
        type: "error",
        code: "INVALID_CONTROL_FRAME",
        message: "Control frame must be valid JSON",
      });
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      this.#sendClientControl({
        type: "error",
        code: "INVALID_CONTROL_FRAME",
        message: "Control frame must be an object with a string type",
      });
      return;
    }

    switch (parsed.type) {
      case "ping":
        this.#sendClientControl({ type: "pong" });
        return;
      case "mode": {
        if (typeof parsed.observe !== "boolean") {
          this.#sendClientControl({
            type: "error",
            code: "INVALID_CONTROL_FRAME",
            message: "mode requires boolean observe",
          });
          return;
        }
        const nextCols = parsed.cols;
        const nextRows = parsed.rows;
        const hasCols = nextCols !== undefined;
        const hasRows = nextRows !== undefined;
        if (hasCols || hasRows) {
          if (
            typeof nextCols !== "number" ||
            !Number.isInteger(nextCols) ||
            nextCols < 1 ||
            nextCols > 500 ||
            typeof nextRows !== "number" ||
            !Number.isInteger(nextRows) ||
            nextRows < 1 ||
            nextRows > 200
          ) {
            this.#sendClientControl({
              type: "error",
              code: "INVALID_CONTROL_FRAME",
              message:
                "mode cols (1..500) and rows (1..200) must both be valid integers",
            });
            return;
          }
          this.#cols = nextCols;
          this.#rows = nextRows;
        }
        this.#observe = parsed.observe;
        this.#sendDaemonControl({
          type: "mode",
          observe: this.#observe,
          ...(hasCols && hasRows ? { cols: this.#cols, rows: this.#rows } : {}),
        });
        return;
      }
      case "focus": {
        if (typeof parsed.focused !== "boolean") {
          this.#sendClientControl({
            type: "error",
            code: "INVALID_CONTROL_FRAME",
            message: "focus requires boolean focused",
          });
          return;
        }
        if (!this.#observe) {
          this.#sendDaemonControl({ type: "focus", focused: parsed.focused });
        }
        return;
      }
      case "resize": {
        if (this.#observe) {
          this.#sendClientControl({
            type: "error",
            code: "OBSERVE_ONLY",
            message: "Cannot resize terminal while observe=true",
          });
          return;
        }
        const cols = parsed.cols;
        const rows = parsed.rows;
        if (
          typeof cols !== "number" ||
          !Number.isInteger(cols) ||
          cols < 1 ||
          cols > 500 ||
          typeof rows !== "number" ||
          !Number.isInteger(rows) ||
          rows < 1 ||
          rows > 200
        ) {
          this.#sendClientControl({
            type: "error",
            code: "INVALID_CONTROL_FRAME",
            message: "resize requires integer cols (1..500) and rows (1..200)",
          });
          return;
        }
        this.#cols = cols;
        this.#rows = rows;
        this.#sendDaemonControl({ type: "resize", cols, rows });
        return;
      }
      case "put": {
        if (this.#observe) {
          this.#sendClientControl({
            type: "error",
            code: "OBSERVE_ONLY",
            message: "Cannot upload files while observe=true",
          });
          return;
        }
        if (
          typeof parsed.name !== "string" ||
          parsed.name.length < 1 ||
          parsed.name.length > 256 ||
          typeof parsed.data_base64 !== "string" ||
          parsed.data_base64.length > MAX_PUT_BASE64_LENGTH
        ) {
          this.#sendClientControl({
            type: "error",
            code: "INVALID_CONTROL_FRAME",
            message: "put requires valid name and bounded data_base64",
          });
          return;
        }
        this.#sendDaemonControl({
          type: "put",
          name: parsed.name,
          data_base64: parsed.data_base64,
        });
        return;
      }
      default:
        this.#sendClientControl({
          type: "error",
          code: "INVALID_CONTROL_FRAME",
          message: `Unsupported client control frame type: ${parsed.type}`,
        });
    }
  }

  #handleDaemonMessage(data: RawData, isBinary: boolean): void {
    if (this.#closed || this.#clientWs.readyState !== WebSocket.OPEN) return;

    if (isBinary) {
      if (!this.#attachedSent) {
        this.#attachedSent = true;
        this.#sendClientControl({
          type: "attached",
          address: this.claims.address,
          cols: this.#cols,
          rows: this.#rows,
          observe: this.#observe,
          resumed: Boolean(this.claims.resumed),
        });
      }
      if (this.#clientWs.bufferedAmount >= this.#clientHardLimitBytes) {
        logAgentEvent("warn", "runner.herdr_core_stream.slow_consumer", {
          computerId: this.claims.computer_id,
          sessionId: this.claims.session_id,
          bufferedAmount: this.#clientWs.bufferedAmount,
        });
        this.closeWithReason("slow_consumer");
        return;
      }
      this.#clientWs.send(rawDataToBuffer(data), { binary: true });
      if (this.#clientWs.bufferedAmount >= this.#clientHighWaterBytes) {
        this.#pauseDaemonForBackpressure();
      }
      return;
    }

    const rawText = rawDataToBuffer(data).toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return;
    }
    if (
      !isRecord(parsed) ||
      typeof parsed.type !== "string" ||
      !DAEMON_CONTROL_TYPES.has(parsed.type)
    ) {
      return;
    }
    if (parsed.type === "attached") {
      this.#attachedSent = true;
    }
    this.#sendClientControl(parsed);
    if (parsed.type === "closed") {
      const reason =
        typeof parsed.reason === "string" ? parsed.reason : "daemon_closed";
      this.#teardown(reason);
    }
  }

  #pauseDaemonForBackpressure(): void {
    if (this.#daemonPaused || !this.#daemonWs) return;
    const rawSocket = socketOf(this.#daemonWs);
    if (!rawSocket) return;
    this.#daemonPaused = true;
    rawSocket.pause();
    this.#drainTimer ??= setInterval(() => {
      if (this.#closed || !this.#daemonWs) {
        this.#clearDrainTimer();
        return;
      }
      if (this.#clientWs.bufferedAmount >= this.#clientHardLimitBytes) {
        this.closeWithReason("slow_consumer");
        return;
      }
      if (this.#clientWs.bufferedAmount < this.#clientHighWaterBytes / 2) {
        this.#daemonPaused = false;
        this.#clearDrainTimer();
        socketOf(this.#daemonWs)?.resume();
      }
    }, DRAIN_POLL_INTERVAL_MS);
    this.#drainTimer.unref();
  }

  #sendClientControl(payload: Record<string, unknown>): void {
    if (this.#clientWs.readyState !== WebSocket.OPEN) return;
    this.#clientWs.send(JSON.stringify(payload));
  }

  #sendDaemonControl(payload: Record<string, unknown>): void {
    if (!this.#daemonWs || this.#daemonWs.readyState !== WebSocket.OPEN) return;
    this.#daemonWs.send(JSON.stringify(payload));
  }

  #clearJoinTimer(): void {
    if (this.#joinTimer) {
      clearTimeout(this.#joinTimer);
      this.#joinTimer = undefined;
    }
  }

  #clearDrainTimer(): void {
    if (this.#drainTimer) {
      clearInterval(this.#drainTimer);
      this.#drainTimer = undefined;
    }
  }

  #teardown(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    this.#clearJoinTimer();
    this.#clearDrainTimer();
    if (
      this.#clientWs.readyState === WebSocket.OPEN ||
      this.#clientWs.readyState === WebSocket.CONNECTING
    ) {
      this.#clientWs.close(
        reason === "slow_consumer" ? 1008 : 1000,
        reason.slice(0, 120),
      );
    }
    if (
      this.#daemonWs &&
      (this.#daemonWs.readyState === WebSocket.OPEN ||
        this.#daemonWs.readyState === WebSocket.CONNECTING)
    ) {
      this.#daemonWs.close(1000, reason.slice(0, 120));
    }
    this.#onClosed();
  }
}

function isValidAttachClaims(
  value: unknown,
): value is HerdrCoreAttachTokenClaims {
  if (!isRecord(value)) return false;
  return (
    value.v === 1 &&
    isBoundedString(value.session_id, 1, 128) &&
    isBoundedString(value.computer_id, 1, 128) &&
    isBoundedString(value.tenant_id, 1, 128) &&
    isBoundedString(value.owner_actor_id, 1, 128) &&
    isBoundedString(value.address, 1, 256) &&
    typeof value.cols === "number" &&
    Number.isInteger(value.cols) &&
    value.cols >= 1 &&
    value.cols <= 500 &&
    typeof value.rows === "number" &&
    Number.isInteger(value.rows) &&
    value.rows >= 1 &&
    value.rows <= 200 &&
    typeof value.observe === "boolean" &&
    typeof value.history === "number" &&
    Number.isInteger(value.history) &&
    value.history >= 0 &&
    value.history <= 10_000 &&
    (value.resumed === undefined || typeof value.resumed === "boolean") &&
    typeof value.exp === "number" &&
    Number.isSafeInteger(value.exp) &&
    value.exp > 0
  );
}

function isBoundedString(
  value: unknown,
  min: number,
  max: number,
): value is string {
  return (
    typeof value === "string" && value.length >= min && value.length <= max
  );
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function socketOf(ws: WebSocket): Duplex | undefined {
  const internal = (ws as unknown as { _socket?: Duplex })._socket;
  return internal && typeof internal.pause === "function"
    ? internal
    : undefined;
}

function readBearerHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

function readHeaderString(
  header: string | string[] | undefined,
): string | undefined {
  if (typeof header === "string") return header.trim() || undefined;
  if (Array.isArray(header) && header.length > 0) {
    return header[0]?.trim() || undefined;
  }
  return undefined;
}

function rejectHttpUpgrade(
  socket: Duplex,
  status: number,
  reason: string,
  headers: Record<string, string> = {},
): void {
  if (socket.destroyed) return;
  const lines = [
    `HTTP/1.1 ${status} ${reason}`,
    "Connection: close",
    "Content-Length: 0",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    "",
  ];
  socket.end(lines.join("\r\n"));
}
