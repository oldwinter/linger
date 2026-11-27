import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanionGateway } from "../companion/gateway.js";
import { PairingManager, ensureHostId } from "../companion/pairing.js";
import { silentLog, tempDirectory } from "../test-support.js";
import {
  detectHerdrCore,
  locateHerdrCoreBinary,
  parseHcVersionOutput,
  resolveHerdrCoreSocketPath,
  startHerdrCoreServer,
} from "./detector.js";
import {
  decodeAndValidatePutBase64,
  HerdrCoreLocalBridge,
  validatePutFilename,
} from "./local-bridge.js";
import {
  decodeCreditPayload,
  decodeFocusPayload,
  decodeResizePayload,
  encodeCreditPayload,
  encodeFocusPayload,
  encodeFrame,
  encodeResizePayload,
  FrameDecoder,
  FrameKind,
  HerdrCoreFramedSession,
  RPC_CHANNEL,
  type HerdrCoreFrame,
  type HerdrCoreTransport,
} from "./protocol.js";

function createInMemoryHerdrCore(options: {
  readonly onRpc?: (method: string, params: Record<string, unknown>) => unknown;
  readonly onClientFrame?: (frame: HerdrCoreFrame) => void;
}) {
  let serverWritable: PassThrough | null = null;
  const receivedFrames: HerdrCoreFrame[] = [];
  const rpcCalls: {
    readonly method: string;
    readonly params: Record<string, unknown>;
  }[] = [];

  const connectTransport = async (): Promise<HerdrCoreTransport> => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    serverWritable = serverToClient;

    let framed = false;
    let lineBuf = "";
    const decoder = new FrameDecoder();

    const handleRpc = (req: {
      readonly id?: number;
      readonly method: string;
      readonly params?: Record<string, unknown>;
    }): { readonly framedSwitch?: boolean; readonly response: unknown } => {
      const params = req.params ?? {};
      rpcCalls.push({ method: req.method, params });
      if (req.method === "hello") {
        const wantFramed = params.framed === true;
        return {
          framedSwitch: wantFramed,
          response: {
            jsonrpc: "2.0",
            id: req.id,
            result: {
              generation: 1,
              framed: wantFramed,
              version: "0.1.21",
              core: { id: "core-test-1", name: "test-host" },
            },
          },
        };
      }
      const custom = options.onRpc?.(req.method, params);
      if (custom !== undefined) {
        return {
          response: {
            jsonrpc: "2.0",
            id: req.id,
            result: custom,
          },
        };
      }
      return {
        response: {
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: -32000,
            message: "not_found",
            data: { kind: "not_found" },
          },
        },
      };
    };

    clientToServer.on("data", (chunk: Buffer) => {
      if (!framed) {
        lineBuf += chunk.toString("utf8");
        const nl = lineBuf.indexOf("\n");
        if (nl === -1) return;
        const line = lineBuf.slice(0, nl);
        const rest = Buffer.from(lineBuf.slice(nl + 1), "utf8");
        lineBuf = "";
        const req = JSON.parse(line) as {
          readonly id?: number;
          readonly method: string;
          readonly params?: Record<string, unknown>;
        };
        const out = handleRpc(req);
        serverToClient.write(`${JSON.stringify(out.response)}\n`);
        if (out.framedSwitch) {
          framed = true;
          if (rest.length > 0) {
            clientToServer.emit("data", rest);
          }
        }
        return;
      }

      for (const frame of decoder.push(chunk)) {
        if (frame.channel === RPC_CHANNEL && frame.kind === FrameKind.DATA) {
          const req = JSON.parse(frame.payload.toString("utf8")) as {
            readonly id?: number;
            readonly method: string;
            readonly params?: Record<string, unknown>;
          };
          const out = handleRpc(req);
          serverToClient.write(
            encodeFrame(
              RPC_CHANNEL,
              FrameKind.DATA,
              Buffer.from(JSON.stringify(out.response), "utf8"),
            ),
          );
        } else {
          receivedFrames.push(frame);
          options.onClientFrame?.(frame);
        }
      }
    });

    return {
      readable: serverToClient,
      writable: clientToServer,
      close: () => {
        clientToServer.end();
        serverToClient.end();
      },
    };
  };

  return {
    connectTransport,
    rpcCalls,
    receivedFrames,
    pushServerFrame: (channel: number, kind: number, payload?: Buffer) => {
      serverWritable?.write(encodeFrame(channel, kind, payload));
    },
  };
}

function encodeClientWsFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4);
  const len = payload.length;
  let headerLen = 2;
  if (len >= 126 && len <= 0xffff) headerLen = 4;
  else if (len > 0xffff) headerLen = 10;

  const out = Buffer.allocUnsafe(headerLen + 4 + len);
  out[0] = 0x80 | (opcode & 0x0f);
  if (len < 126) {
    out[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    out[1] = 0x80 | 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 0x80 | 127;
    out.writeBigUInt64BE(BigInt(len), 2);
  }
  mask.copy(out, headerLen);
  for (let i = 0; i < len; i += 1) {
    out[headerLen + 4 + i] = payload[i]! ^ mask[i & 3]!;
  }
  return out;
}

interface RawWsClient {
  readonly messages: {
    readonly kind: "text" | "binary";
    readonly data: Buffer;
  }[];
  sendText(text: string): void;
  sendBinary(data: Buffer): void;
  waitForMessage(
    predicate: (msg: {
      readonly kind: "text" | "binary";
      readonly data: Buffer;
    }) => boolean,
    timeoutMs?: number,
  ): Promise<{ readonly kind: "text" | "binary"; readonly data: Buffer }>;
  close(): void;
}

async function openRawWsClient(options: {
  readonly port: number;
  readonly path: string;
  readonly headers?: Record<string, string>;
}): Promise<RawWsClient> {
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  const socket = net.createConnection({
    host: "127.0.0.1",
    port: options.port,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const extraHeaders = Object.entries(options.headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  socket.write(
    [
      `GET ${options.path} HTTP/1.1`,
      `Host: 127.0.0.1:${options.port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      ...(extraHeaders ? [extraHeaders] : []),
      "",
      "",
    ].join("\r\n"),
  );

  const messages: {
    readonly kind: "text" | "binary";
    readonly data: Buffer;
  }[] = [];
  const waiters: (() => void)[] = [];
  let handshakeDone = false;
  let rawBuf = Buffer.alloc(0);

  const parseFrames = (): void => {
    while (rawBuf.length >= 2) {
      const opcode = rawBuf[0]! & 0x0f;
      let len = rawBuf[1]! & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (rawBuf.length < 4) return;
        len = rawBuf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (rawBuf.length < 10) return;
        len = Number(rawBuf.readBigUInt64BE(2));
        offset = 10;
      }
      if (rawBuf.length < offset + len) return;
      const payload = Buffer.from(rawBuf.subarray(offset, offset + len));
      rawBuf = rawBuf.subarray(offset + len);
      if (opcode === 0x1) {
        messages.push({ kind: "text", data: payload });
        for (const wake of waiters.splice(0)) wake();
      } else if (opcode === 0x2) {
        messages.push({ kind: "binary", data: payload });
        for (const wake of waiters.splice(0)) wake();
      }
    }
  };

  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      rawBuf = Buffer.concat([rawBuf, chunk]);
      if (!handshakeDone) {
        const idx = rawBuf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headerText = rawBuf.subarray(0, idx).toString("utf8");
        rawBuf = rawBuf.subarray(idx + 4);
        if (
          !headerText.startsWith("HTTP/1.1 101") ||
          !headerText.includes(expectedAccept)
        ) {
          reject(new Error(`WS handshake rejected: ${headerText}`));
          return;
        }
        handshakeDone = true;
        resolve();
        parseFrames();
        return;
      }
      parseFrames();
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });

  return {
    messages,
    sendText(text: string) {
      socket.write(encodeClientWsFrame(0x1, Buffer.from(text, "utf8")));
    },
    sendBinary(data: Buffer) {
      socket.write(encodeClientWsFrame(0x2, data));
    },
    async waitForMessage(predicate, timeoutMs = 3_000) {
      const existing = messages.find(predicate);
      if (existing) return existing;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for WS message")),
          timeoutMs,
        );
        const check = (): void => {
          const found = messages.find(predicate);
          if (found) {
            clearTimeout(timer);
            resolve(found);
          } else {
            waiters.push(check);
          }
        };
        waiters.push(check);
      });
    },
    close() {
      socket.destroy();
    },
  };
}

describe("herdr-core detector", () => {
  it("resolves default and overridden sockets across macOS, Linux, and Windows", () => {
    expect(
      resolveHerdrCoreSocketPath({
        platform: "darwin",
        env: {},
        homeDir: "/Users/alice",
      }),
    ).toBe("/Users/alice/.local/state/herdr-core/default/default.sock");

    expect(
      resolveHerdrCoreSocketPath({
        platform: "linux",
        env: { XDG_STATE_HOME: "/var/tmp/xdg", HC_SESSION: "work" },
        homeDir: "/home/alice",
      }),
    ).toBe("/var/tmp/xdg/herdr-core/work/work.sock");

    expect(
      resolveHerdrCoreSocketPath({
        platform: "darwin",
        env: { HC_SOCKET: "/custom/path/core.sock" },
        homeDir: "/Users/alice",
      }),
    ).toBe("/custom/path/core.sock");

    expect(
      resolveHerdrCoreSocketPath({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local" },
        homeDir: "C:\\Users\\Alice",
      }),
    ).toBe(
      "C:\\Users\\Alice\\AppData\\Local\\herdr-core\\default\\default.sock",
    );
  });

  it("locates macOS Herdr Core.app bundle fallback and parses hc --version", () => {
    const appBin =
      "/Users/alice/.local/share/herdr-core/active/Herdr Core.app/Contents/MacOS/herdr-core";
    const found = locateHerdrCoreBinary({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      homeDir: "/Users/alice",
      isExecutable: (p) => p === appBin,
    });
    expect(found).toBe(appBin);
    expect(parseHcVersionOutput("hc 0.1.21\n")).toBe("0.1.21");
    expect(parseHcVersionOutput("herdr-core 0.2.0-rc1")).toBe("0.2.0-rc1");
  });

  it("prefers reusing a running shared core and only starts server on explicit request", async () => {
    const sock = "/Users/alice/.local/state/herdr-core/default/default.sock";
    const runCommand = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "--version") return { stdout: "hc 0.1.21\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    const detected = await detectHerdrCore({
      platform: "darwin",
      env: { PATH: "/Users/alice/.local/bin" },
      homeDir: "/Users/alice",
      isExecutable: (p) => p === "/Users/alice/.local/bin/hc",
      isSocket: (p) => p === sock,
      runCommand,
    });
    expect(detected.installed).toBe(true);
    expect(detected.running).toBe(true);
    expect(detected.sharedCore).toBe(true);
    expect(detected.version).toBe("0.1.21");

    // startHerdrCoreServer must reuse an already running shared core without calling `server start`.
    const reused = await startHerdrCoreServer({
      platform: "darwin",
      env: { PATH: "/Users/alice/.local/bin" },
      homeDir: "/Users/alice",
      isExecutable: (p) => p === "/Users/alice/.local/bin/hc",
      isSocket: (p) => p === sock,
      runCommand,
    });
    expect(reused.ok).toBe(true);
    expect(runCommand.mock.calls.some(([, args]) => args[0] === "server")).toBe(
      false,
    );

    // When stopped, explicit start invokes `hc server start`.
    let started = false;
    const startMock = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "--version") return { stdout: "hc 0.1.21\n", stderr: "" };
      if (args[0] === "server" && args[1] === "start") {
        started = true;
      }
      return { stdout: "", stderr: "" };
    });
    const startedResult = await startHerdrCoreServer({
      platform: "darwin",
      env: { PATH: "/Users/alice/.local/bin" },
      homeDir: "/Users/alice",
      isExecutable: (p) => p === "/Users/alice/.local/bin/hc",
      isSocket: (p) => started && p === sock,
      runCommand: startMock,
    });
    expect(startedResult.ok).toBe(true);
    expect(startedResult.detection.running).toBe(true);
    expect(
      startMock.mock.calls.some(
        ([, args]) => args[0] === "server" && args[1] === "start",
      ),
    ).toBe(true);
  });
});

describe("herdr-core binary framing protocol", () => {
  it("encodes and decodes fragmented 9-byte LE frames, credit, resize, and focus payloads", () => {
    const f1 = encodeFrame(0, FrameKind.DATA, Buffer.from('{"id":1}', "utf8"));
    const f2 = encodeFrame(3, FrameKind.CREDIT, encodeCreditPayload(512));
    const f3 = encodeFrame(3, FrameKind.RESIZE, encodeResizePayload(120, 40));
    const f4 = encodeFrame(3, FrameKind.FOCUS, encodeFocusPayload(true));

    // Verify exact 9-byte little-endian header wire layout:
    // bytes 0..3 channel (u32 LE), byte 4 kind (u8), bytes 5..8 length (u32 LE).
    expect(f2.subarray(0, 9)).toEqual(
      Buffer.from([0x03, 0x00, 0x00, 0x00, 0x01, 0x04, 0x00, 0x00, 0x00]),
    );
    expect(f4.subarray(0, 10)).toEqual(
      Buffer.from([0x03, 0x00, 0x00, 0x00, 0x04, 0x01, 0x00, 0x00, 0x00, 0x01]),
    );

    const stream = Buffer.concat([f1, f2, f3, f4]);

    const decoder = new FrameDecoder();
    const out: HerdrCoreFrame[] = [];
    // Feed in tiny odd-sized slices to prove streaming reassembly works.
    for (let i = 0; i < stream.length; i += 3) {
      out.push(...decoder.push(stream.subarray(i, i + 3)));
    }
    expect(out).toHaveLength(4);
    expect(out[0]!.channel).toBe(0);
    expect(out[0]!.kind).toBe(FrameKind.DATA);
    expect(out[0]!.payload.toString("utf8")).toBe('{"id":1}');
    expect(out[1]!.channel).toBe(3);
    expect(out[1]!.kind).toBe(FrameKind.CREDIT);
    expect(decodeCreditPayload(out[1]!.payload)).toBe(512);
    expect(out[2]!.channel).toBe(3);
    expect(out[2]!.kind).toBe(FrameKind.RESIZE);
    expect(decodeResizePayload(out[2]!.payload)).toEqual({
      cols: 120,
      rows: 40,
    });
    expect(out[3]!.channel).toBe(3);
    expect(out[3]!.kind).toBe(FrameKind.FOCUS);
    expect(decodeFocusPayload(out[3]!.payload)).toBe(true);
    expect(decodeFocusPayload(encodeFocusPayload(false))).toBe(false);
  });

  it("performs hello(framed: true) handshake and multiplexes RPC + stream frames", async () => {
    const frames: HerdrCoreFrame[] = [];
    const mock = createInMemoryHerdrCore({
      onRpc: (method) => {
        if (method === "terminal.attach") {
          return {
            channel: 7,
            terminal: { address: "t1", cols: 90, rows: 30, state: "live" },
            resize_notifications: true,
            automatic_input: true,
          };
        }
        return undefined;
      },
    });
    const { session, hello } = await HerdrCoreFramedSession.connect(
      { connectTransport: mock.connectTransport },
      { onFrame: (frame) => frames.push(frame) },
    );
    expect(hello.framed).toBe(true);
    const attached = await session.call<{ readonly channel: number }>(
      "terminal.attach",
      { terminal: "t1", cols: 90, rows: 30, observe: true },
    );
    expect(attached.channel).toBe(7);

    mock.pushServerFrame(7, FrameKind.DATA, Buffer.from("hello-pty", "utf8"));
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(frames[0]!.payload.toString("utf8")).toBe("hello-pty");
    session.close();
  });
});

describe("HerdrCoreLocalBridge HTTP, put limits, observe enforcement, and Companion Gateway", () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const stop of cleanups.splice(0).reverse()) {
      await stop();
    }
  });

  it("validates terminal.put filenames and enforces max byte limits", () => {
    expect(validatePutFilename("screenshot.png")).toBe("screenshot.png");
    expect(validatePutFilename("../etc/passwd")).toBeNull();
    expect(validatePutFilename("dir/file.txt")).toBeNull();
    expect(validatePutFilename("")).toBeNull();

    const ok = decodeAndValidatePutBase64(
      Buffer.from("hello world").toString("base64"),
      64,
    );
    expect(ok).toEqual({
      ok: true,
      bytes: 11,
      normalized: Buffer.from("hello world").toString("base64"),
    });

    const tooLarge = decodeAndValidatePutBase64(
      Buffer.alloc(200, 0x41).toString("base64"),
      64,
    );
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  it("serves authenticated REST APIs, enforces put limit, and enforces WS observe/take-over", async () => {
    let nextChannel = 1;
    let docValue: unknown = { spaces: [{ id: "sp-1", name: "Main" }] };
    let docVersion = 2;

    const mock = createInMemoryHerdrCore({
      onRpc: (method, params) => {
        switch (method) {
          case "server.status":
            return {
              core: { id: "core-1", name: "workstation" },
              version: "0.1.21",
              pid: 4242,
              uptime_ms: 99_000,
              live: 2,
              finished: 1,
            };
          case "terminal.list":
            return {
              terminals: [
                {
                  address: "t1",
                  name: "reviewer",
                  state: "live",
                  cwd: "/repo",
                  argv: ["claude"],
                  labels: { "linger.room": "room-1", "herdr.space": "sp-1" },
                  cols: 120,
                  rows: 40,
                  created_ms: 1000,
                  status: { state: "blocked", msg: "Approve edit?" },
                },
                {
                  address: "vps/t2",
                  name: "builder",
                  state: "live",
                  cwd: "/srv/app",
                  argv: ["cargo", "test"],
                  labels: { "linger.room": "room-2" },
                  cols: 120,
                  rows: 40,
                  created_ms: 2000,
                  status: { state: "working", msg: "Compiling", progress: 42 },
                },
              ],
              hidden_finished: 1,
              machines: [
                { name: "vps", host: "vps.local", state: "connected" },
              ],
            };
          case "terminal.read":
            return {
              text: "line 1\nline 2",
              complete: true,
              how: "screen",
              why: null,
            };
          case "terminal.put":
            return { path: `/tmp/herdr/${String(params.name)}` };
          case "doc.get":
            return { value: docValue, version: docVersion };
          case "doc.set":
            docValue = params.value;
            docVersion += 1;
            return { version: docVersion };
          case "terminal.attach":
            return {
              channel: nextChannel++,
              terminal: {
                address: String(params.terminal),
                cols: Number(params.cols),
                rows: Number(params.rows),
                state: "live",
                cwd: "/repo",
                argv: ["sh"],
                labels: {},
                created_ms: 1000,
              },
              resize_notifications: true,
              automatic_input: true,
            };
          default:
            return { ok: true };
        }
      },
    });

    const bridge = new HerdrCoreLocalBridge({
      maxPutBytes: 32,
      getAllowedOrigin: () => "http://127.0.0.1:3000",
      dialTargetOverride: () => ({ connectTransport: mock.connectTransport }),
      log: silentLog,
    });
    const port = await bridge.start();
    cleanups.push(() => bridge.stop());
    const token = bridge.token();

    // Unauthenticated rejected.
    const unauth = await fetch(`http://127.0.0.1:${port}/herdr-core/status`);
    expect(unauth.status).toBe(401);

    // Foreign browser origin rejected.
    const badOrigin = await fetch(
      `http://127.0.0.1:${port}/herdr-core/status`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://evil.example",
        },
      },
    );
    expect(badOrigin.status).toBe(403);

    // Allowed origin + bearer token returns full aggregated status.
    const statusRes = await fetch(
      `http://127.0.0.1:${port}/herdr-core/status`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "http://127.0.0.1:3000",
        },
      },
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toMatchObject({
      available: true,
      version: "0.1.21",
      core_id: "core-1",
      blocked_count: 1,
      working_count: 1,
      live_count: 2,
    });

    // Filtering by room_id and machine works.
    const roomTerms = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminals?room_id=room-1`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const roomPayload = (await roomTerms.json()) as {
      readonly terminals: readonly { readonly address: string }[];
    };
    expect(roomPayload.terminals.map((t) => t.address)).toEqual(["t1"]);

    // Put size limit enforced (413 when > 32 bytes).
    const oversizePut = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/put`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          address: "t1",
          name: "big.bin",
          data_base64: Buffer.alloc(64, 0x42).toString("base64"),
        }),
      },
    );
    expect(oversizePut.status).toBe(413);

    // Valid put succeeds.
    const okPut = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/put`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          address: "t1",
          name: "note.txt",
          data_base64: Buffer.from("hi").toString("base64"),
        }),
      },
    );
    expect(okPut.status).toBe(200);
    expect(await okPut.json()).toEqual({
      path: "/tmp/herdr/note.txt",
      name: "note.txt",
      bytes: 2,
    });

    // Docs GET + PUT work.
    const docGet = await fetch(
      `http://127.0.0.1:${port}/herdr-core/docs/herdr-app`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(await docGet.json()).toEqual({
      value: { spaces: [{ id: "sp-1", name: "Main" }] },
      version: 2,
    });

    // Interactive WS attach: defaults to observe=true and blocks binary input & resize.
    const ws = await openRawWsClient({
      port,
      path: `/herdr-core/attach?address=t1&cols=100&rows=30&observe=true&token=${encodeURIComponent(token)}`,
    });
    cleanups.push(async () => ws.close());

    const attachedMsg = await ws.waitForMessage(
      (m) =>
        m.kind === "text" && m.data.toString("utf8").includes('"attached"'),
    );
    expect(JSON.parse(attachedMsg.data.toString("utf8"))).toMatchObject({
      type: "attached",
      observe: true,
    });

    // Server PTY output streams as binary WS frame AND triggers automatic CREDIT frame back to core.
    mock.pushServerFrame(1, FrameKind.DATA, Buffer.from("PROMPT> ", "utf8"));
    const ptyOut = await ws.waitForMessage((m) => m.kind === "binary");
    expect(ptyOut.data.toString("utf8")).toBe("PROMPT> ");
    await vi.waitFor(() =>
      expect(
        mock.receivedFrames.some(
          (f) =>
            f.channel === 1 &&
            f.kind === FrameKind.CREDIT &&
            decodeCreditPayload(f.payload) === 8,
        ),
      ).toBe(true),
    );

    // Core RESIZE notification forwards as JSON text frame.
    mock.pushServerFrame(1, FrameKind.RESIZE, encodeResizePayload(140, 44));
    const resizeNotif = await ws.waitForMessage(
      (m) => m.kind === "text" && m.data.toString("utf8").includes('"resize"'),
    );
    expect(JSON.parse(resizeNotif.data.toString("utf8"))).toEqual({
      type: "resize",
      cols: 140,
      rows: 44,
    });

    // Binary input while observing is BLOCKED and emits OBSERVE_ONLY error.
    ws.sendBinary(Buffer.from("rm -rf /\n", "utf8"));
    const blockedErr = await ws.waitForMessage(
      (m) =>
        m.kind === "text" && m.data.toString("utf8").includes("OBSERVE_ONLY"),
    );
    expect(JSON.parse(blockedErr.data.toString("utf8"))).toMatchObject({
      type: "error",
      code: "OBSERVE_ONLY",
    });
    expect(mock.receivedFrames.some((f) => f.kind === FrameKind.DATA)).toBe(
      false,
    );

    // Take Over switches to observe=false on a new attach channel (resumed: true).
    ws.sendText(
      JSON.stringify({ type: "mode", observe: false, cols: 110, rows: 35 }),
    );
    const takenOver = await ws.waitForMessage(
      (m) =>
        m.kind === "text" &&
        m.data.toString("utf8").includes('"observe":false'),
    );
    expect(JSON.parse(takenOver.data.toString("utf8"))).toMatchObject({
      type: "attached",
      observe: false,
      cols: 110,
      rows: 35,
    });

    // Now binary input & resize forward directly to core on channel 2.
    ws.sendBinary(Buffer.from("ls\n", "utf8"));
    ws.sendText(JSON.stringify({ type: "resize", cols: 132, rows: 42 }));
    await vi.waitFor(() => {
      expect(
        mock.receivedFrames.some(
          (f) =>
            f.channel === 2 &&
            f.kind === FrameKind.DATA &&
            f.payload.toString("utf8") === "ls\n",
        ),
      ).toBe(true);
      expect(
        mock.receivedFrames.some(
          (f) =>
            f.channel === 2 &&
            f.kind === FrameKind.RESIZE &&
            decodeResizePayload(f.payload)?.cols === 132,
        ),
      ).toBe(true);
    });

    // Ping/pong and WS put size limit check.
    ws.sendText(JSON.stringify({ type: "ping" }));
    const pong = await ws.waitForMessage(
      (m) => m.kind === "text" && m.data.toString("utf8").includes('"pong"'),
    );
    expect(JSON.parse(pong.data.toString("utf8"))).toEqual({ type: "pong" });

    ws.sendText(
      JSON.stringify({
        type: "put",
        name: "huge.bin",
        data_base64: Buffer.alloc(64, 0x43).toString("base64"),
      }),
    );
    const putErr = await ws.waitForMessage(
      (m) =>
        m.kind === "text" &&
        m.data.toString("utf8").includes("PAYLOAD_TOO_LARGE"),
    );
    expect(JSON.parse(putErr.data.toString("utf8"))).toMatchObject({
      type: "error",
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("enforces hc v0.1.21 terminal.send if=blocked pre-check via terminal.get and strips if before RPC", async () => {
    const terminalsByAddr = new Map<string, Record<string, unknown>>([
      [
        "t-blocked",
        {
          address: "t-blocked",
          state: "live",
          cwd: "/repo",
          argv: ["claude"],
          labels: {},
          cols: 100,
          rows: 30,
          created_ms: 1000,
          turn: 2,
          status: { state: "blocked", kind: "permission", msg: "Run tests?" },
        },
      ],
      [
        "t-working",
        {
          address: "t-working",
          state: "live",
          cwd: "/repo",
          argv: ["claude"],
          labels: {},
          cols: 100,
          rows: 30,
          created_ms: 1001,
          status: { state: "working", msg: "Building" },
        },
      ],
      [
        "t-finished",
        {
          address: "t-finished",
          state: "finished",
          cwd: "/repo",
          argv: ["claude"],
          labels: {},
          cols: 100,
          rows: 30,
          created_ms: 1002,
          status: null,
        },
      ],
    ]);

    const mock = createInMemoryHerdrCore({
      onRpc: (method, params) => {
        if (method === "terminal.get") {
          return terminalsByAddr.get(String(params.terminal));
        }
        if (method === "terminal.send") {
          // Mirror real herdr-core v0.1.21 validation: only idle | working allowed in `if`.
          if (
            params.if !== undefined &&
            params.if !== "idle" &&
            params.if !== "working"
          ) {
            throw new Error(
              `unexpected invalid_params if=${String(params.if)}`,
            );
          }
          return { turn: 3, started: true, status: "working" };
        }
        return undefined;
      },
    });

    const bridge = new HerdrCoreLocalBridge({
      dialTargetOverride: () => ({ connectTransport: mock.connectTransport }),
      log: silentLog,
    });
    const port = await bridge.start();
    cleanups.push(() => bridge.stop());
    const headers = {
      authorization: `Bearer ${bridge.token()}`,
      "content-type": "application/json",
    };

    // 1. Live + blocked with { if: "blocked", turn: 2, force: true } verifies via terminal.get,
    //    then calls terminal.send WITHOUT `if` and WITH `force: true`.
    const blockedOk = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          address: "t-blocked",
          text: "yes",
          if: "blocked",
          turn: 2,
          force: true,
        }),
      },
    );
    expect(blockedOk.status).toBe(200);
    expect(await blockedOk.json()).toEqual({
      turn: 3,
      started: true,
      status: "working",
    });
    expect(mock.rpcCalls).toEqual([
      { method: "terminal.get", params: { terminal: "t-blocked" } },
      {
        method: "terminal.send",
        params: { terminal: "t-blocked", text: "yes", force: true },
      },
    ]);

    // 1b. Stale turn with if: "blocked" rejects with 409 CONFLICT without calling terminal.send.
    mock.rpcCalls.length = 0;
    const staleTurnRes = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          address: "t-blocked",
          text: "yes",
          if: "blocked",
          turn: 99,
          force: true,
        }),
      },
    );
    expect(staleTurnRes.status).toBe(409);
    expect(mock.rpcCalls).toEqual([
      { method: "terminal.get", params: { terminal: "t-blocked" } },
    ]);

    // 2. Live + working with if: "blocked" rejects with 409 CONFLICT without calling terminal.send.
    mock.rpcCalls.length = 0;
    const mismatchRes = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          address: "t-working",
          text: "yes",
          if: "blocked",
          force: true,
        }),
      },
    );
    expect(mismatchRes.status).toBe(409);
    expect(mock.rpcCalls).toEqual([
      { method: "terminal.get", params: { terminal: "t-working" } },
    ]);

    // 3. Finished terminal with if: "blocked" rejects with 410 FINISHED without calling terminal.send.
    mock.rpcCalls.length = 0;
    const finishedRes = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          address: "t-finished",
          text: "yes",
          if: "blocked",
          force: true,
        }),
      },
    );
    expect(finishedRes.status).toBe(410);
    expect(mock.rpcCalls).toEqual([
      { method: "terminal.get", params: { terminal: "t-finished" } },
    ]);

    // 4. Native if: "idle" passes straight through to herdr-core terminal.send without extra get.
    mock.rpcCalls.length = 0;
    const idleOk = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          address: "t-working",
          text: "next step",
          if: "idle",
        }),
      },
    );
    expect(idleOk.status).toBe(200);
    expect(mock.rpcCalls).toEqual([
      {
        method: "terminal.send",
        params: { terminal: "t-working", text: "next step", if: "idle" },
      },
    ]);
  });

  it("exposes local herdr-core HTTP and WS attach through CompanionGateway for paired LAN devices", async () => {
    const dir = tempDirectory();
    const hostId = ensureHostId(dir);
    const pairing = new PairingManager({
      directory: dir,
      hostId,
      getHostName: () => "Studio Mac",
      getTlsFingerprint: () => "",
      getTenantId: () => "t-1",
      mintDeviceSession: async () => ({
        sessionCookie: "sess-1",
        sessionMode: "dedicated",
        tenantId: "t-1",
      }),
      logoutDedicatedSession: async () => {},
      log: silentLog,
    });
    const activePairing = pairing.openPairingWindow();
    const paired = await pairing.pair({
      pin: activePairing.pin,
      device_name: "Phone",
      platform: "ios",
    });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;

    const mock = createInMemoryHerdrCore({
      onRpc: (method) => {
        if (method === "server.status") {
          return {
            core: { id: "lan-core", name: "studio" },
            version: "0.1.21",
            pid: 99,
            uptime_ms: 5000,
            terminals: { live: 1, finished: 0 },
          };
        }
        if (method === "terminal.list") {
          return { terminals: [], machines: [] };
        }
        if (method === "terminal.attach") {
          return {
            channel: 1,
            terminal: { address: "t1", cols: 80, rows: 24, state: "live" },
          };
        }
        return undefined;
      },
    });

    const bridge = new HerdrCoreLocalBridge({
      dialTargetOverride: () => ({ connectTransport: mock.connectTransport }),
      log: silentLog,
    });
    await bridge.start();
    cleanups.push(() => bridge.stop());

    const gateway = new CompanionGateway({
      bindHost: "127.0.0.1",
      port: 0,
      tls: false,
      pairing,
      hostId,
      getHostName: () => "Studio Mac",
      desktopVersion: "0.16.20",
      getTeamHubBaseUrl: () => undefined,
      getDocumentRuntimeUrl: () => undefined,
      getHerdrCoreBridge: () => bridge,
      getStatusSnapshot: () => ({
        computer_id: "comp-1",
        daemon_connection: "online",
        runtime_state: "ready",
        active_operations: 0,
        prevent_sleep: false,
        local_server_phase: "ready",
        local_models_degraded: false,
        server_url_mode: "local",
      }),
      log: silentLog,
    });
    const gwPort = await gateway.start();
    cleanups.push(() => gateway.stop());

    // Unauthenticated rejected.
    const denied = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: gwPort,
          path: "/companion/v1/herdr-core/status",
          method: "GET",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(denied).toBe(401);

    // Paired bearer token succeeds.
    const statusBody = await new Promise<{
      readonly status: number;
      readonly body: string;
    }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: gwPort,
          path: "/companion/v1/herdr-core/status",
          method: "GET",
          headers: {
            authorization: `Bearer ${paired.payload.token}`,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(statusBody.status).toBe(200);
    expect(JSON.parse(statusBody.body)).toMatchObject({
      available: true,
      core_id: "lan-core",
    });

    // Paired LAN WebSocket attach succeeds.
    const ws = await openRawWsClient({
      port: gwPort,
      path: "/companion/v1/herdr-core/attach?address=t1&observe=true",
      headers: {
        Authorization: `Bearer ${paired.payload.token}`,
      },
    });
    cleanups.push(async () => ws.close());
    const attached = await ws.waitForMessage(
      (m) =>
        m.kind === "text" && m.data.toString("utf8").includes('"attached"'),
    );
    expect(JSON.parse(attached.data.toString("utf8"))).toMatchObject({
      type: "attached",
      observe: true,
    });
  });

  it("buffers and replays initial PTY DATA frames coalesced with the terminal.attach RPC reply", async () => {
    const receivedFrames: HerdrCoreFrame[] = [];
    const connectTransport = async (): Promise<HerdrCoreTransport> => {
      const clientToServer = new PassThrough();
      const serverToClient = new PassThrough();
      let framed = false;
      let lineBuf = "";
      const decoder = new FrameDecoder();

      clientToServer.on("data", (chunk: Buffer) => {
        if (!framed) {
          lineBuf += chunk.toString("utf8");
          const nl = lineBuf.indexOf("\n");
          if (nl === -1) return;
          const req = JSON.parse(lineBuf.slice(0, nl)) as {
            readonly id: number;
          };
          lineBuf = "";
          serverToClient.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { generation: 1, framed: true, version: "0.1.21" },
            })}\n`,
          );
          framed = true;
          return;
        }
        for (const frame of decoder.push(chunk)) {
          if (frame.channel === RPC_CHANNEL && frame.kind === FrameKind.DATA) {
            const req = JSON.parse(frame.payload.toString("utf8")) as {
              readonly id: number;
              readonly method: string;
            };
            if (req.method === "terminal.attach") {
              // Emit channel-0 RPC reply and channel-1 initial paint in a SINGLE
              // socket chunk to exercise the coalesced-frame buffering path.
              const rpcReply = encodeFrame(
                RPC_CHANNEL,
                FrameKind.DATA,
                Buffer.from(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: req.id,
                    result: {
                      channel: 5,
                      terminal: {
                        address: "t1",
                        cols: 80,
                        rows: 24,
                        state: "live",
                        cwd: "/",
                        argv: ["sh"],
                        labels: {},
                        created_ms: 1000,
                      },
                      resize_notifications: true,
                      automatic_input: true,
                    },
                  }),
                  "utf8",
                ),
              );
              const initialPaint = encodeFrame(
                5,
                FrameKind.DATA,
                Buffer.from("COALESCED_PAINT", "utf8"),
              );
              serverToClient.write(Buffer.concat([rpcReply, initialPaint]));
            }
          } else {
            receivedFrames.push(frame);
          }
        }
      });

      return {
        readable: serverToClient,
        writable: clientToServer,
        close: () => {
          clientToServer.end();
          serverToClient.end();
        },
      };
    };

    const bridge = new HerdrCoreLocalBridge({
      dialTargetOverride: () => ({ connectTransport }),
      log: silentLog,
    });
    const port = await bridge.start();
    cleanups.push(() => bridge.stop());

    const ws = await openRawWsClient({
      port,
      path: `/herdr-core/attach?address=t1&cols=80&rows=24&observe=true&token=${encodeURIComponent(bridge.token())}`,
    });
    cleanups.push(async () => ws.close());

    const attached = await ws.waitForMessage(
      (m) =>
        m.kind === "text" && m.data.toString("utf8").includes('"attached"'),
    );
    const paint = await ws.waitForMessage((m) => m.kind === "binary");
    expect(ws.messages.indexOf(attached)).toBeLessThan(
      ws.messages.indexOf(paint),
    );
    expect(paint.data.toString("utf8")).toBe("COALESCED_PAINT");
    await vi.waitFor(() =>
      expect(
        receivedFrames.some(
          (f) =>
            f.channel === 5 &&
            f.kind === FrameKind.CREDIT &&
            decodeCreditPayload(f.payload) === "COALESCED_PAINT".length,
        ),
      ).toBe(true),
    );
  });

  it("normalizes null label removals to empty strings and parses COLSxROWS terminal sizes for hc v0.1.21", async () => {
    const mock = createInMemoryHerdrCore({
      onRpc: (_method, params) => ({ ok: true, params }),
    });
    const bridge = new HerdrCoreLocalBridge({
      dialTargetOverride: () => ({ connectTransport: mock.connectTransport }),
      log: silentLog,
    });
    const port = await bridge.start();
    cleanups.push(() => bridge.stop());
    const headers = {
      authorization: `Bearer ${bridge.token()}`,
      "content-type": "application/json",
    };

    const labelRes = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminal/label`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          address: "t1",
          labels: { "herdr.space": "sp-1", "herdr.tab": null },
        }),
      },
    );
    expect(labelRes.status).toBe(200);
    expect(mock.rpcCalls[0]).toEqual({
      method: "terminal.label",
      params: {
        terminal: "t1",
        labels: { "herdr.space": "sp-1", "herdr.tab": "" },
      },
    });

    mock.rpcCalls.length = 0;
    const createRes = await fetch(
      `http://127.0.0.1:${port}/herdr-core/terminals`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          argv: ["/bin/sh"],
          size: "120x36",
        }),
      },
    );
    expect(createRes.status).toBe(200);
    expect(mock.rpcCalls[0]).toEqual({
      method: "terminal.run",
      params: {
        argv: ["/bin/sh"],
        size: { cols: 120, rows: 36 },
      },
    });
  });
});
