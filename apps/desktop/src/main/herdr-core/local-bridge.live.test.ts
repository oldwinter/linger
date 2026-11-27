import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { silentLog } from "../test-support.js";
import { locateHerdrCoreBinary } from "./detector.js";
import { HerdrCoreLocalBridge } from "./local-bridge.js";

const execFileAsync = promisify(execFile);

const LIVE_ENABLED = process.env.HERDR_CORE_LIVE_TEST === "1";

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

interface RawWsMessage {
  readonly kind: "text" | "binary";
  readonly data: Buffer;
}

interface RawWsClient {
  readonly messages: RawWsMessage[];
  sendText(text: string): void;
  sendBinary(data: Buffer): void;
  waitForMessage(
    predicate: (msg: RawWsMessage) => boolean,
    timeoutMs?: number,
  ): Promise<RawWsMessage>;
  waitForBinaryText(needle: string, timeoutMs?: number): Promise<string>;
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

  const messages: RawWsMessage[] = [];
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

  const combinedBinaryText = (): string =>
    Buffer.concat(
      messages.filter((m) => m.kind === "binary").map((m) => m.data),
    ).toString("utf8");

  return {
    messages,
    sendText(text: string) {
      socket.write(encodeClientWsFrame(0x1, Buffer.from(text, "utf8")));
    },
    sendBinary(data: Buffer) {
      socket.write(encodeClientWsFrame(0x2, data));
    },
    async waitForMessage(predicate, timeoutMs = 8_000) {
      const existing = messages.find(predicate);
      if (existing) return existing;
      return await new Promise<RawWsMessage>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting for WS message (${messages.length} received)`,
              ),
            ),
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
    async waitForBinaryText(needle: string, timeoutMs = 8_000) {
      const initial = combinedBinaryText();
      if (initial.includes(needle)) return initial;
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting for PTY output containing "${needle}". Got: ${JSON.stringify(combinedBinaryText())}`,
              ),
            ),
          timeoutMs,
        );
        const check = (): void => {
          const text = combinedBinaryText();
          if (text.includes(needle)) {
            clearTimeout(timer);
            resolve(text);
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

function buildIsolatedHcEnv(options: {
  readonly rootDir: string;
  readonly session: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.HC_SOCKET;
  delete env.HC_TERMINAL_ID;
  delete env.HC_CORE_ID;
  env.HC_SESSION = options.session;
  env.XDG_STATE_HOME = path.join(options.rootDir, "s");
  env.XDG_CONFIG_HOME = path.join(options.rootDir, "c");
  env.XDG_CACHE_HOME = path.join(options.rootDir, "k");
  env.XDG_DATA_HOME = path.join(options.rootDir, "d");
  return env;
}

describe.runIf(LIVE_ENABLED)(
  "HerdrCoreLocalBridge live isolated integration against real hc binary",
  () => {
    let tempRoot = "";
    let isolatedSession = "";
    let isolatedEnv: NodeJS.ProcessEnv = {};
    let binaryPath = "";
    let bridge: HerdrCoreLocalBridge | null = null;
    let bridgePort = 0;
    let authHeaders: Record<string, string> = {};

    beforeAll(async () => {
      const located = locateHerdrCoreBinary();
      if (!located) {
        throw new Error(
          "Real herdr-core (hc) binary not found; cannot run HERDR_CORE_LIVE_TEST=1.",
        );
      }
      binaryPath = located;

      // Keep POSIX socket paths well under macOS SUN_LEN (104 bytes).
      const baseTmp = process.platform === "win32" ? os.tmpdir() : "/tmp";
      tempRoot = mkdtempSync(path.join(baseTmp, "hc-e2e-"));
      for (const sub of ["s", "c", "k", "d"]) {
        mkdirSync(path.join(tempRoot, sub), { recursive: true });
      }
      isolatedSession = `t${randomBytes(3).toString("hex")}`;
      isolatedEnv = buildIsolatedHcEnv({
        rootDir: tempRoot,
        session: isolatedSession,
      });

      // Start an isolated herdr-core server without touching the user's default server.
      await execFileAsync(binaryPath, ["server", "start", "--json"], {
        env: isolatedEnv,
        timeout: 15_000,
      });

      bridge = new HerdrCoreLocalBridge({
        detectorDeps: {
          env: isolatedEnv,
        },
        log: silentLog,
      });
      bridgePort = await bridge.start();
      authHeaders = {
        authorization: `Bearer ${bridge.token()}`,
        "content-type": "application/json",
      };
    }, 30_000);

    afterAll(async () => {
      if (bridge) {
        await bridge.stop();
        bridge = null;
      }
      if (binaryPath && isolatedSession) {
        try {
          await execFileAsync(binaryPath, ["server", "stop", "--json"], {
            env: isolatedEnv,
            timeout: 10_000,
          });
        } catch {
          // Best-effort isolated server cleanup.
        }
      }
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }, 20_000);

    it("exercises full HTTP, CAS send/docs, terminal.put, WS attach observe/interactive framing, kill, and rm lifecycle", async () => {
      const base = `http://127.0.0.1:${bridgePort}/herdr-core`;

      // 1. GET /status
      const statusRes = await fetch(`${base}/status`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as {
        readonly available: boolean;
        readonly version: string | null;
        readonly core_id: string | null;
        readonly core_name: string | null;
        readonly pid: number | null;
        readonly live_count: number;
      };
      expect(statusJson.available).toBe(true);
      expect(statusJson.version).toMatch(/^\d+\.\d+\.\d+/u);
      expect(statusJson.core_id).toBeTruthy();
      expect(statusJson.core_name).toBeTruthy();
      expect(typeof statusJson.pid).toBe("number");
      expect(statusJson.live_count).toBe(0);

      // 2. POST /terminals (run interactive POSIX shell)
      const createRes = await fetch(`${base}/terminals`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          argv: ["/bin/sh"],
          name: "e2e-shell",
          cwd: tempRoot,
          labels: { "linger.room": "room-e2e", "linger.origin": "live-test" },
          size: { cols: 100, rows: 30 },
        }),
      });
      expect(createRes.status).toBe(200);
      const createdJson = (await createRes.json()) as {
        readonly terminal: {
          readonly address: string;
          readonly name: string | null;
          readonly state: string;
          readonly labels: Record<string, string>;
        };
      };
      const address = createdJson.terminal.address;
      expect(address).toBeTruthy();
      expect(createdJson.terminal.name).toBe("e2e-shell");
      expect(createdJson.terminal.state).toBe("live");
      expect(createdJson.terminal.labels["linger.room"]).toBe("room-e2e");

      // 3. GET /terminals
      const listRes = await fetch(`${base}/terminals?room_id=room-e2e`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as {
        readonly terminals: readonly { readonly address: string }[];
      };
      expect(listJson.terminals.map((t) => t.address)).toContain(address);

      // 4. GET /terminal?address=...
      const getRes = await fetch(
        `${base}/terminal?address=${encodeURIComponent(address)}`,
        { headers: { authorization: authHeaders.authorization! } },
      );
      expect(getRes.status).toBe(200);
      const getJson = (await getRes.json()) as {
        readonly terminal: { readonly address: string; readonly state: string };
      };
      expect(getJson.terminal.address).toBe(address);
      expect(getJson.terminal.state).toBe("live");

      // 5. POST /terminal/send (normal) + GET /terminal/read
      const sendMarker = `E2E_SEND_${randomBytes(4).toString("hex")}`;
      const sendRes = await fetch(`${base}/terminal/send`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          text: `printf '%s\\n' ${sendMarker}`,
        }),
      });
      expect(sendRes.status).toBe(200);

      let readText = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const readRes = await fetch(
          `${base}/terminal/read?address=${encodeURIComponent(address)}&lines=100`,
          { headers: { authorization: authHeaders.authorization! } },
        );
        expect(readRes.status).toBe(200);
        const readJson = (await readRes.json()) as {
          readonly text: string;
          readonly complete: boolean;
        };
        readText = readJson.text;
        if (readText.includes(sendMarker)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(readText).toContain(sendMarker);

      // 6. POST /terminal/send with if: "blocked" CAS check -> 409 when not blocked
      const casFailRes = await fetch(`${base}/terminal/send`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          text: "should-not-deliver",
          if: "blocked",
        }),
      });
      expect(casFailRes.status).toBe(409);

      // 6b. Run a foreground helper that emits real OSC 7501 blocked status
      //     (colon-separated per OSC 7501 spec; interactive shell clears status
      //     when returning to the prompt, so the helper blocks on `read`).
      const unblockMarker = `UNBLOCK_${randomBytes(3).toString("hex")}`;
      const blockedMsgB64 = Buffer.from("Approve?", "utf8").toString("base64");
      await fetch(`${base}/terminal/send`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          text: `sh -c 'printf "\\033]7501;state=blocked:kind=permission:msg=${blockedMsgB64}\\007"; IFS= read -r reply; printf "\\033]7501;state=idle\\007REPLY:%s\\n" "$reply"'`,
        }),
      });
      let blockedTurn = -1;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const curRes = await fetch(
          `${base}/terminal?address=${encodeURIComponent(address)}`,
          { headers: { authorization: authHeaders.authorization! } },
        );
        const curJson = (await curRes.json()) as {
          readonly terminal: {
            readonly turn?: number;
            readonly status?: { readonly state?: string } | null;
          };
        };
        if (curJson.terminal.status?.state === "blocked") {
          blockedTurn = curJson.terminal.turn ?? 0;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(blockedTurn).toBeGreaterThanOrEqual(0);

      const blockedStatusRes = await fetch(`${base}/status`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(await blockedStatusRes.json()).toMatchObject({
        available: true,
        live_count: 1,
        blocked_count: 1,
      });

      const staleTurnRes = await fetch(`${base}/terminal/send`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          text: "stale",
          if: "blocked",
          turn: blockedTurn + 99,
        }),
      });
      expect(staleTurnRes.status).toBe(409);

      const blockedOkRes = await fetch(`${base}/terminal/send`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          text: unblockMarker,
          if: "blocked",
          turn: blockedTurn,
        }),
      });
      expect(blockedOkRes.status).toBe(200);

      let unblockRead = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const readRes = await fetch(
          `${base}/terminal/read?address=${encodeURIComponent(address)}&lines=100`,
          { headers: { authorization: authHeaders.authorization! } },
        );
        unblockRead = ((await readRes.json()) as { readonly text: string })
          .text;
        if (unblockRead.includes(`REPLY:${unblockMarker}`)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(unblockRead).toContain(`REPLY:${unblockMarker}`);

      // 6c. POST /terminal/label (set + delete via null), GET /templates, GET /machines, 404 unknown terminal.
      const labelSetRes = await fetch(`${base}/terminal/label`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          labels: { "herdr.space": "e2e-space" },
        }),
      });
      expect(labelSetRes.status).toBe(200);
      const labelDelRes = await fetch(`${base}/terminal/label`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          labels: { "herdr.space": null },
        }),
      });
      expect(labelDelRes.status).toBe(200);
      const afterLabelDel = (await (
        await fetch(`${base}/terminal?address=${encodeURIComponent(address)}`, {
          headers: { authorization: authHeaders.authorization! },
        })
      ).json()) as {
        readonly terminal: { readonly labels: Record<string, string> };
      };
      expect(afterLabelDel.terminal.labels["herdr.space"]).toBeUndefined();

      const templatesRes = await fetch(`${base}/templates`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(templatesRes.status).toBe(200);
      expect(
        Array.isArray(
          ((await templatesRes.json()) as { readonly templates: unknown[] })
            .templates,
        ),
      ).toBe(true);

      const machinesRes = await fetch(`${base}/machines`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(machinesRes.status).toBe(200);
      expect(
        Array.isArray(
          ((await machinesRes.json()) as { readonly machines: unknown[] })
            .machines,
        ),
      ).toBe(true);

      const missingTermRes = await fetch(`${base}/terminal?address=t99999`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(missingTermRes.status).toBe(404);

      // 7. POST /terminal/keys
      const keysRes = await fetch(`${base}/terminal/keys`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          keys: ["e", "c", "h", "o", "space", "k", "e", "y", "o", "k", "enter"],
        }),
      });
      expect(keysRes.status).toBe(200);

      let keysReadText = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const readRes = await fetch(
          `${base}/terminal/read?address=${encodeURIComponent(address)}&lines=100`,
          { headers: { authorization: authHeaders.authorization! } },
        );
        const readJson = (await readRes.json()) as { readonly text: string };
        keysReadText = readJson.text;
        if (keysReadText.includes("\nkeyok")) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(keysReadText).toContain("\nkeyok");

      // 8. POST /terminal/interrupt (interrupt a foreground sleep)
      await fetch(`${base}/terminal/send`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ address, text: "sleep 30" }),
      });
      await new Promise((r) => setTimeout(r, 200));
      const intRes = await fetch(`${base}/terminal/interrupt`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ address, timeout: 5 }),
      });
      expect(intRes.status).toBe(200);
      const intJson = (await intRes.json()) as {
        readonly outcome?: string;
        readonly key?: string;
      };
      expect(intJson.key).toBeTruthy();
      expect(intJson.outcome).toBeTruthy();

      // 9. POST /terminal/put
      const putPayload = "hello-herdr-put-payload\n";
      const putRes = await fetch(`${base}/terminal/put`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          address,
          name: "linger-e2e.txt",
          data_base64: Buffer.from(putPayload, "utf8").toString("base64"),
        }),
      });
      expect(putRes.status).toBe(200);
      const putJson = (await putRes.json()) as {
        readonly path: string;
        readonly name: string;
        readonly bytes: number;
      };
      expect(putJson.path).toContain("linger-e2e.txt");
      expect(putJson.bytes).toBe(Buffer.byteLength(putPayload, "utf8"));
      expect(existsSync(putJson.path)).toBe(true);
      expect(readFileSync(putJson.path, "utf8")).toBe(putPayload);

      // 10. GET /docs/linger-test & PUT /docs/linger-test (with CAS version check)
      const docGet0 = await fetch(`${base}/docs/linger-test`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(docGet0.status).toBe(200);
      const doc0 = (await docGet0.json()) as {
        readonly value: unknown;
        readonly version: number;
      };
      expect(doc0.version).toBe(0);
      expect(doc0.value).toBeNull();

      const docPut1 = await fetch(`${base}/docs/linger-test`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          value: { feature: "herdr-core", step: 1 },
          version: doc0.version,
        }),
      });
      expect(docPut1.status).toBe(200);
      const docPut1Json = (await docPut1.json()) as {
        readonly version: number;
      };
      expect(docPut1Json.version).toBeGreaterThan(doc0.version);

      const docGet1 = await fetch(`${base}/docs/linger-test`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(docGet1.status).toBe(200);
      expect(await docGet1.json()).toEqual({
        value: { feature: "herdr-core", step: 1 },
        version: docPut1Json.version,
      });

      // Stale version MUST fail with 409 CONFLICT.
      const docPutStale = await fetch(`${base}/docs/linger-test`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          value: { feature: "herdr-core", step: 99 },
          version: 0,
        }),
      });
      expect(docPutStale.status).toBe(409);

      // 11. WebSocket GET /attach: observe=true rejects client binary input;
      //     switching to observe=false delivers input and receives real PTY bytes!
      const ws = await openRawWsClient({
        port: bridgePort,
        path: `/herdr-core/attach?address=${encodeURIComponent(address)}&cols=100&rows=30&observe=true&history=200&token=${encodeURIComponent(bridge!.token())}`,
      });
      try {
        const attachedObserve = await ws.waitForMessage(
          (m) =>
            m.kind === "text" && m.data.toString("utf8").includes('"attached"'),
        );
        expect(JSON.parse(attachedObserve.data.toString("utf8"))).toMatchObject(
          {
            type: "attached",
            observe: true,
          },
        );

        // Should receive real initial PTY bytes from the live shell over 9-byte LE framing.
        const initialPty = await ws.waitForBinaryText(sendMarker);
        expect(initialPty).toContain(sendMarker);

        // Observe mode MUST reject client binary input and resize.
        ws.sendBinary(Buffer.from("echo SHOULD_NOT_RUN\n", "utf8"));
        const observeErr = await ws.waitForMessage(
          (m) =>
            m.kind === "text" &&
            m.data.toString("utf8").includes("OBSERVE_ONLY"),
        );
        expect(JSON.parse(observeErr.data.toString("utf8"))).toMatchObject({
          type: "error",
          code: "OBSERVE_ONLY",
        });

        ws.sendText(JSON.stringify({ type: "ping" }));
        const pongMsg = await ws.waitForMessage(
          (m) =>
            m.kind === "text" && m.data.toString("utf8").includes('"pong"'),
        );
        expect(JSON.parse(pongMsg.data.toString("utf8"))).toEqual({
          type: "pong",
        });

        // Switch to interactive mode (observe=false) and verify live PTY round-trip + resize + WS put.
        ws.sendText(
          JSON.stringify({
            type: "mode",
            observe: false,
            cols: 110,
            rows: 34,
          }),
        );
        const attachedInteractive = await ws.waitForMessage(
          (m) =>
            m.kind === "text" &&
            m.data.toString("utf8").includes('"observe":false'),
        );
        expect(
          JSON.parse(attachedInteractive.data.toString("utf8")),
        ).toMatchObject({
          type: "attached",
          observe: false,
        });

        ws.sendText(JSON.stringify({ type: "resize", cols: 116, rows: 36 }));
        const wsMarker = `WS_LIVE_${randomBytes(4).toString("hex")}`;
        ws.sendBinary(Buffer.from(`printf '%s\\n' ${wsMarker}\n`, "utf8"));
        const livePty = await ws.waitForBinaryText(wsMarker);
        expect(livePty).toContain(wsMarker);

        ws.sendText(
          JSON.stringify({
            type: "put",
            name: "ws-put.txt",
            data_base64: Buffer.from("ws-file-ok", "utf8").toString("base64"),
          }),
        );
        const wsPutResult = await ws.waitForMessage(
          (m) =>
            m.kind === "text" && m.data.toString("utf8").includes("put_result"),
        );
        const parsedWsPut = JSON.parse(wsPutResult.data.toString("utf8")) as {
          readonly type: string;
          readonly path: string;
          readonly name: string;
          readonly bytes: number;
        };
        expect(parsedWsPut).toMatchObject({
          type: "put_result",
          name: "ws-put.txt",
          bytes: 10,
        });
        expect(readFileSync(parsedWsPut.path, "utf8")).toBe("ws-file-ok");
      } finally {
        ws.close();
      }

      // 12. POST /terminal/kill & DELETE /terminal
      const killRes = await fetch(`${base}/terminal/kill`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ address }),
      });
      expect(killRes.status).toBe(200);

      // Wait briefly until hc marks the terminal finished before removing it.
      let finished = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const checkRes = await fetch(
          `${base}/terminal?address=${encodeURIComponent(address)}`,
          { headers: { authorization: authHeaders.authorization! } },
        );
        const checkJson = (await checkRes.json()) as {
          readonly terminal?: { readonly state?: string };
        };
        if (checkJson.terminal?.state === "finished") {
          finished = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(finished).toBe(true);

      const rmRes = await fetch(
        `${base}/terminal?address=${encodeURIComponent(address)}`,
        {
          method: "DELETE",
          headers: { authorization: authHeaders.authorization! },
        },
      );
      expect(rmRes.status).toBe(200);
      expect(await rmRes.json()).toMatchObject({ removed: true, address });

      // Confirm /status returns live_count: 0 after full teardown.
      const finalStatus = await fetch(`${base}/status`, {
        headers: { authorization: authHeaders.authorization! },
      });
      expect(finalStatus.status).toBe(200);
      expect(await finalStatus.json()).toMatchObject({
        available: true,
        live_count: 0,
      });
    }, 30_000);
  },
);
