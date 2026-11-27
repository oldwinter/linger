import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_MAX_MESSAGE_BYTES = 24 * 1024 * 1024;

export const WsOpcode = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

export interface WebSocketHandlers {
  readonly onText?: (text: string) => void;
  readonly onBinary?: (data: Buffer) => void;
  readonly onClose?: (code: number, reason: string) => void;
  readonly onError?: (error: Error) => void;
}

export interface WebSocketServerConnection {
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
  sendPong(payload?: Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly closed: boolean;
}

export function encodeServerWsFrame(
  opcode: number,
  payload: Uint8Array = Buffer.alloc(0),
): Buffer {
  const len = payload.byteLength;
  let headerLen = 2;
  if (len >= 126 && len <= 0xffff) {
    headerLen = 4;
  } else if (len > 0xffff) {
    headerLen = 10;
  }

  const frame = Buffer.allocUnsafe(headerLen + len);
  frame[0] = 0x80 | (opcode & 0x0f);
  if (len < 126) {
    frame[1] = len;
  } else if (len <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
  }

  if (len > 0) {
    Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(
      frame,
      headerLen,
    );
  }
  return frame;
}

/**
 * Completes an RFC 6455 WebSocket handshake on a Node HTTP upgrade socket
 * without requiring external WebSocket server dependencies.
 */
export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  handlers: WebSocketHandlers,
  options: { readonly maxMessageBytes?: number } = {},
): WebSocketServerConnection | null {
  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  if (upgrade !== "websocket" || typeof key !== "string" || version !== "13") {
    if (!socket.destroyed) {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    }
    return null;
  }

  const accept = createHash("sha1")
    .update(`${key.trim()}${WS_GUID}`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  let closed = false;
  let buffer: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let fragmentedOpcode: number | null = null;
  let fragmentChunks: Buffer[] = [];
  let fragmentBytes = 0;

  const notifyClose = (code: number, reason: string): void => {
    if (closed) return;
    closed = true;
    handlers.onClose?.(code, reason);
  };

  const closeConnection = (code = 1000, reason = ""): void => {
    if (closed) return;
    closed = true;
    if (!socket.destroyed) {
      const reasonBuf = Buffer.from(reason, "utf8").subarray(0, 123);
      const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      try {
        socket.end(encodeServerWsFrame(WsOpcode.CLOSE, payload));
      } catch {
        socket.destroy();
      }
    }
    handlers.onClose?.(code, reason);
  };

  const failProtocol = (code: number, reason: string): void => {
    closeConnection(code, reason);
  };

  const processBuffer = (): void => {
    while (!closed && buffer.length >= 2) {
      const first = buffer[0]!;
      const second = buffer[1]!;
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLen = second & 0x7f;
      let offset = 2;

      if (!masked) {
        // RFC 6455 §5.1: client-to-server frames MUST be masked.
        failProtocol(1002, "Client frames must be masked");
        return;
      }

      if (payloadLen === 126) {
        if (buffer.length < offset + 2) return;
        payloadLen = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (buffer.length < offset + 8) return;
        const bigLen = buffer.readBigUInt64BE(offset);
        if (bigLen > BigInt(maxMessageBytes)) {
          failProtocol(1009, "Message too large");
          return;
        }
        payloadLen = Number(bigLen);
        offset += 8;
      }

      if (payloadLen > maxMessageBytes) {
        failProtocol(1009, "Message too large");
        return;
      }

      const maskOffset = offset;
      const dataOffset = offset + 4;
      const frameTotal = dataOffset + payloadLen;
      if (buffer.length < frameTotal) return;

      const mask = buffer.subarray(maskOffset, dataOffset);
      const payload = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i += 1) {
        payload[i] = buffer[dataOffset + i]! ^ mask[i & 3]!;
      }
      buffer = buffer.subarray(frameTotal);

      if (opcode >= 0x8) {
        if (!fin || payloadLen > 125) {
          failProtocol(1002, "Invalid control frame");
          return;
        }
        if (opcode === WsOpcode.PING) {
          if (!socket.destroyed) {
            socket.write(encodeServerWsFrame(WsOpcode.PONG, payload));
          }
        } else if (opcode === WsOpcode.CLOSE) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
          const reason =
            payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
          closeConnection(code, reason);
          return;
        }
        continue;
      }

      if (opcode === WsOpcode.CONTINUATION) {
        if (fragmentedOpcode === null) {
          failProtocol(1002, "Unexpected continuation frame");
          return;
        }
        fragmentBytes += payload.length;
        if (fragmentBytes > maxMessageBytes) {
          failProtocol(1009, "Message too large");
          return;
        }
        fragmentChunks.push(payload);
        if (fin) {
          const full = Buffer.concat(fragmentChunks);
          const finalOpcode = fragmentedOpcode;
          fragmentedOpcode = null;
          fragmentChunks = [];
          fragmentBytes = 0;
          if (finalOpcode === WsOpcode.TEXT) {
            handlers.onText?.(full.toString("utf8"));
          } else if (finalOpcode === WsOpcode.BINARY) {
            handlers.onBinary?.(full);
          }
        }
      } else if (opcode === WsOpcode.TEXT || opcode === WsOpcode.BINARY) {
        if (fragmentedOpcode !== null) {
          failProtocol(1002, "Interleaved fragmented message");
          return;
        }
        if (fin) {
          if (opcode === WsOpcode.TEXT) {
            handlers.onText?.(payload.toString("utf8"));
          } else {
            handlers.onBinary?.(payload);
          }
        } else {
          fragmentedOpcode = opcode;
          fragmentChunks = [payload];
          fragmentBytes = payload.length;
        }
      } else {
        failProtocol(1002, "Unsupported opcode");
        return;
      }
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    processBuffer();
  });
  socket.on("close", () => notifyClose(1006, "Connection closed"));
  socket.on("error", (err) => {
    handlers.onError?.(err);
    notifyClose(1006, err.message);
  });

  if (buffer.length > 0) {
    queueMicrotask(processBuffer);
  }

  return {
    get closed() {
      return closed;
    },
    sendText(text: string): void {
      if (closed || socket.destroyed) return;
      socket.write(
        encodeServerWsFrame(WsOpcode.TEXT, Buffer.from(text, "utf8")),
      );
    },
    sendBinary(data: Uint8Array): void {
      if (closed || socket.destroyed) return;
      socket.write(encodeServerWsFrame(WsOpcode.BINARY, data));
    },
    sendPong(payload?: Uint8Array): void {
      if (closed || socket.destroyed) return;
      socket.write(encodeServerWsFrame(WsOpcode.PONG, payload));
    },
    close: closeConnection,
  };
}
