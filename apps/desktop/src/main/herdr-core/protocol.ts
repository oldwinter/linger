import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import type { Duplex, Readable, Writable } from "node:stream";

export const FRAME_HEADER_BYTES = 9;
export const MAX_FRAME_PAYLOAD_BYTES = 32 * 1024 * 1024;
export const RPC_CHANNEL = 0;

export const FrameKind = {
  DATA: 0,
  CREDIT: 1,
  CLOSE: 2,
  RESIZE: 3,
  FOCUS: 4,
  FACTS: 5,
  AUTOMATIC_INPUT: 6,
} as const;

export type FrameKindValue = (typeof FrameKind)[keyof typeof FrameKind];

export interface HerdrCoreFrame {
  readonly channel: number;
  readonly kind: number;
  readonly payload: Buffer;
}

export class HerdrCoreRpcError extends Error {
  readonly code: number;
  readonly kind: string;
  readonly hint?: string;

  constructor(options: {
    readonly code: number;
    readonly kind: string;
    readonly message: string;
    readonly hint?: string;
  }) {
    super(options.message);
    this.name = "HerdrCoreRpcError";
    this.code = options.code;
    this.kind = options.kind;
    this.hint = options.hint;
  }
}

export function encodeFrame(
  channel: number,
  kind: number,
  payload: Uint8Array = Buffer.alloc(0),
): Buffer {
  const buf = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.byteLength);
  buf.writeUInt32LE(channel >>> 0, 0);
  buf.writeUInt8(kind & 0xff, 4);
  buf.writeUInt32LE(payload.byteLength >>> 0, 5);
  if (payload.byteLength > 0) {
    Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(
      buf,
      FRAME_HEADER_BYTES,
    );
  }
  return buf;
}

export function encodeCreditPayload(bytes: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32LE(Math.max(0, Math.trunc(bytes)) >>> 0, 0);
  return buf;
}

export function decodeCreditPayload(payload: Buffer): number {
  if (payload.length < 4) return 0;
  return payload.readUInt32LE(0);
}

export function encodeResizePayload(cols: number, rows: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt16LE(Math.max(1, Math.min(65535, Math.trunc(cols))), 0);
  buf.writeUInt16LE(Math.max(1, Math.min(65535, Math.trunc(rows))), 2);
  return buf;
}

export function decodeResizePayload(
  payload: Buffer,
): { readonly cols: number; readonly rows: number } | null {
  if (payload.length < 4) return null;
  return {
    cols: payload.readUInt16LE(0),
    rows: payload.readUInt16LE(2),
  };
}

export function encodeFocusPayload(focused: boolean): Buffer {
  const buf = Buffer.allocUnsafe(1);
  buf.writeUInt8(focused ? 1 : 0, 0);
  return buf;
}

export function decodeFocusPayload(payload: Buffer): boolean {
  return payload.length >= 1 && payload.readUInt8(0) !== 0;
}

export class FrameDecoder {
  #buffer: Buffer = Buffer.alloc(0);
  readonly #maxPayloadBytes: number;

  constructor(maxPayloadBytes = MAX_FRAME_PAYLOAD_BYTES) {
    this.#maxPayloadBytes = maxPayloadBytes;
  }

  push(chunk: Buffer): HerdrCoreFrame[] {
    this.#buffer =
      this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const frames: HerdrCoreFrame[] = [];

    while (this.#buffer.length >= FRAME_HEADER_BYTES) {
      const channel = this.#buffer.readUInt32LE(0);
      const kind = this.#buffer.readUInt8(4);
      const length = this.#buffer.readUInt32LE(5);
      if (length > this.#maxPayloadBytes) {
        throw new Error(
          `herdr-core frame payload exceeds limit (${length} > ${this.#maxPayloadBytes})`,
        );
      }
      const total = FRAME_HEADER_BYTES + length;
      if (this.#buffer.length < total) break;
      const payload = Buffer.from(
        this.#buffer.subarray(FRAME_HEADER_BYTES, total),
      );
      this.#buffer = this.#buffer.subarray(total);
      frames.push({ channel, kind, payload });
    }

    return frames;
  }
}

export interface HerdrCoreTransport {
  readonly readable: Readable;
  readonly writable: Writable;
  close(): void;
}

export interface HerdrCoreDialTarget {
  readonly socketPath?: string | null;
  readonly binaryPath?: string | null;
  readonly session?: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly connectTransport?: () => Promise<HerdrCoreTransport>;
}

export async function openHerdrCoreTransport(
  target: HerdrCoreDialTarget,
): Promise<HerdrCoreTransport> {
  if (target.connectTransport) {
    return target.connectTransport();
  }

  const platform = target.platform ?? process.platform;
  if (platform !== "win32" && target.socketPath) {
    return await new Promise<HerdrCoreTransport>((resolve, reject) => {
      const socket: Duplex = net.createConnection({ path: target.socketPath! });
      const onError = (err: Error): void => {
        socket.destroy();
        reject(err);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve({
          readable: socket,
          writable: socket,
          close: () => {
            if (!socket.destroyed) socket.destroy();
          },
        });
      });
    });
  }

  if (target.binaryPath) {
    const args = ["connect"];
    if (target.session && target.session !== "default") {
      args.push("--session", target.session);
    }
    const child: ChildProcessWithoutNullStreams = spawn(
      target.binaryPath,
      args,
      {
        env: target.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    return await new Promise<HerdrCoreTransport>((resolve, reject) => {
      const onError = (err: Error): void => {
        reject(err);
      };
      child.once("error", onError);
      child.once("spawn", () => {
        child.off("error", onError);
        resolve({
          readable: child.stdout,
          writable: child.stdin,
          close: () => {
            if (!child.killed) {
              child.stdin.end();
              child.kill();
            }
          },
        });
      });
    });
  }

  throw new Error("herdr-core is not available on this machine.");
}

interface JsonRpcReply {
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly data?: {
      readonly kind?: string;
      readonly hint?: string;
    };
  };
}

function parseRpcError(reply: JsonRpcReply): HerdrCoreRpcError {
  const err = reply.error;
  return new HerdrCoreRpcError({
    code: typeof err?.code === "number" ? err.code : -32000,
    kind:
      typeof err?.data?.kind === "string"
        ? err.data.kind
        : typeof err?.message === "string"
          ? err.message
          : "internal",
    message: typeof err?.message === "string" ? err.message : "RPC failed",
    ...(typeof err?.data?.hint === "string" ? { hint: err.data.hint } : {}),
  });
}

/**
 * Executes a single JSON-RPC 2.0 request over a fresh connection to `herdr-core`.
 */
export async function callHerdrCoreRpc<T = unknown>(
  target: HerdrCoreDialTarget,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<T> {
  const transport = await openHerdrCoreTransport(target);
  const requestId = 1;
  const requestLine = `${JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method,
    params,
  })}\n`;

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => {
      finish(new Error(`herdr-core RPC "${method}" timed out`));
    }, timeoutMs);
    timer.unref();

    const finish = (err: Error | null, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      transport.close();
      if (err) reject(err);
      else resolve(value as T);
    };

    transport.readable.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        if (!line) continue;
        let parsed: JsonRpcReply;
        try {
          parsed = JSON.parse(line) as JsonRpcReply;
        } catch {
          continue;
        }
        if (parsed.id !== requestId) continue;
        if (parsed.error) {
          finish(parseRpcError(parsed));
        } else {
          finish(null, parsed.result as T);
        }
        return;
      }
    });

    transport.readable.once("error", (err) => finish(err));
    transport.readable.once("close", () => {
      if (!settled) {
        finish(new Error(`herdr-core connection closed during "${method}"`));
      }
    });
    transport.writable.once("error", (err) => finish(err));
    transport.writable.write(requestLine);
  });
}

interface PendingRpc {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface FramedSessionHandlers {
  readonly onFrame?: (frame: HerdrCoreFrame) => void;
  readonly onClose?: (error?: Error) => void;
}

/**
 * Persistent framed `herdr-core` session (`hello({ generation: 1, framed: true })`)
 * multiplexing channel-0 JSON-RPC calls alongside live PTY attach channels.
 */
export class HerdrCoreFramedSession {
  readonly #transport: HerdrCoreTransport;
  readonly #decoder = new FrameDecoder();
  readonly #pending = new Map<number, PendingRpc>();
  readonly #handlers: FramedSessionHandlers;
  #nextId = 1;
  #closed = false;
  #framed = false;
  #handshakeBuffer: Buffer = Buffer.alloc(0);

  private constructor(
    transport: HerdrCoreTransport,
    handlers: FramedSessionHandlers,
  ) {
    this.#transport = transport;
    this.#handlers = handlers;
  }

  static async connect(
    target: HerdrCoreDialTarget,
    handlers: FramedSessionHandlers = {},
    timeoutMs = 10_000,
  ): Promise<{
    readonly session: HerdrCoreFramedSession;
    readonly hello: Record<string, unknown>;
  }> {
    const transport = await openHerdrCoreTransport(target);
    const session = new HerdrCoreFramedSession(transport, handlers);
    const hello = await session.#handshake(timeoutMs);
    return { session, hello };
  }

  #handshake(timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error("herdr-core framed hello handshake timed out"));
      }, timeoutMs);
      timer.unref();

      const onData = (chunk: Buffer): void => {
        if (!this.#framed) {
          this.#handshakeBuffer =
            this.#handshakeBuffer.length === 0
              ? chunk
              : Buffer.concat([this.#handshakeBuffer, chunk]);
          const nl = this.#handshakeBuffer.indexOf(0x0a);
          if (nl === -1) return;
          const line = this.#handshakeBuffer.subarray(0, nl).toString("utf8");
          const trailing = Buffer.from(this.#handshakeBuffer.subarray(nl + 1));
          this.#handshakeBuffer = Buffer.alloc(0);
          clearTimeout(timer);

          let reply: JsonRpcReply;
          try {
            reply = JSON.parse(line) as JsonRpcReply;
          } catch (error) {
            settled = true;
            this.close();
            reject(
              new Error(
                `Invalid hello reply from herdr-core: ${String(error)}`,
              ),
            );
            return;
          }
          if (reply.error) {
            settled = true;
            this.close();
            reject(parseRpcError(reply));
            return;
          }
          const result = (reply.result ?? {}) as Record<string, unknown>;
          if (result.framed !== true) {
            settled = true;
            this.close();
            reject(new Error("herdr-core did not accept framed mode"));
            return;
          }

          this.#framed = true;
          settled = true;
          resolve(result);
          if (trailing.length > 0) {
            this.#consumeFramedBytes(trailing);
          }
          return;
        }

        this.#consumeFramedBytes(chunk);
      };

      const onEnd = (err?: Error): void => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err ?? new Error("herdr-core closed before hello completed"));
        }
        this.#failAll(err);
      };

      this.#transport.readable.on("data", onData);
      this.#transport.readable.once("error", (err) => onEnd(err));
      this.#transport.readable.once("close", () => onEnd());
      this.#transport.writable.once("error", (err) => onEnd(err));

      const helloReq = `${JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "hello",
        params: { generation: 1, framed: true },
      })}\n`;
      this.#transport.writable.write(helloReq);
    });
  }

  #consumeFramedBytes(chunk: Buffer): void {
    let frames: HerdrCoreFrame[];
    try {
      frames = this.#decoder.push(chunk);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.#failAll(err);
      this.close();
      return;
    }

    for (const frame of frames) {
      if (frame.channel === RPC_CHANNEL && frame.kind === FrameKind.DATA) {
        this.#handleRpcPayload(frame.payload);
      } else {
        this.#handlers.onFrame?.(frame);
      }
    }
  }

  #handleRpcPayload(payload: Buffer): void {
    let reply: JsonRpcReply;
    try {
      reply = JSON.parse(payload.toString("utf8")) as JsonRpcReply;
    } catch {
      return;
    }
    if (typeof reply.id !== "number") return;
    const entry = this.#pending.get(reply.id);
    if (!entry) return;
    this.#pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.error) {
      entry.reject(parseRpcError(reply));
    } else {
      entry.resolve(reply.result);
    }
  }

  #failAll(err?: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    const reason = err ?? new Error("herdr-core framed session closed");
    for (const [id, entry] of this.#pending) {
      this.#pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.#handlers.onClose?.(err);
  }

  call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    if (this.#closed || !this.#framed) {
      return Promise.reject(new Error("herdr-core framed session is not open"));
    }
    const id = this.#nextId++;
    const body = Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      "utf8",
    );
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`herdr-core framed RPC "${method}" timed out`));
      }, timeoutMs);
      timer.unref();
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.#transport.writable.write(
        encodeFrame(RPC_CHANNEL, FrameKind.DATA, body),
      );
    });
  }

  sendFrame(channel: number, kind: number, payload?: Uint8Array): void {
    if (this.#closed || !this.#framed) return;
    this.#transport.writable.write(encodeFrame(channel, kind, payload));
  }

  sendData(channel: number, data: Uint8Array): void {
    this.sendFrame(channel, FrameKind.DATA, data);
  }

  sendCredit(channel: number, bytes: number): void {
    if (bytes <= 0) return;
    this.sendFrame(channel, FrameKind.CREDIT, encodeCreditPayload(bytes));
  }

  sendResize(channel: number, cols: number, rows: number): void {
    this.sendFrame(channel, FrameKind.RESIZE, encodeResizePayload(cols, rows));
  }

  sendFocus(channel: number, focused: boolean): void {
    this.sendFrame(channel, FrameKind.FOCUS, encodeFocusPayload(focused));
  }

  sendCloseChannel(channel: number): void {
    this.sendFrame(channel, FrameKind.CLOSE);
  }

  close(): void {
    if (!this.#closed) {
      this.#failAll();
    }
    this.#transport.close();
  }
}
