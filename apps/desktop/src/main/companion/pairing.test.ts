import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { silentLog, tempDirectory } from "../test-support.js";
import {
  PairingManager,
  buildPairingUri,
  constantTimeEqual,
  ensureHostId,
  extractSessionFromCookieHeader,
  extractSessionFromSetCookie,
  type MintedDeviceSession,
} from "./pairing.js";

function createManager(
  options: {
    dir?: string;
    now?: () => number;
    sessionMode?: "dedicated" | "delegated";
    mintSession?: () => Promise<MintedDeviceSession | undefined>;
    logoutDedicatedSession?: (cookie: string) => Promise<void>;
    onDeviceRevoked?: (deviceId: string) => void;
  } = {},
) {
  const dir = options.dir ?? path.join(tempDirectory(), "companion");
  const hostId = ensureHostId(dir);
  const manager = new PairingManager({
    directory: dir,
    hostId,
    getHostName: () => "Studio Mac",
    getTlsFingerprint: () => "FP_BASE64URL_43CHARS_0123456789abcdefABCDEF",
    getTenantId: () => "tenant_abc",
    mintDeviceSession:
      options.mintSession ??
      (async () => ({
        sessionCookie: "deadbeef0123456789",
        sessionMode: options.sessionMode ?? "dedicated",
        tenantId: "tenant_abc",
      })),
    logoutDedicatedSession: options.logoutDedicatedSession,
    onDeviceRevoked: options.onDeviceRevoked,
    log: silentLog,
    now: options.now,
  });
  return { dir, hostId, manager };
}

describe("PairingManager", () => {
  it("stays closed by default and rejects pairing attempts with PAIRING_CLOSED", async () => {
    const { manager } = createManager();
    expect(manager.isPairingOpen()).toBe(false);

    const outcome = await manager.pair({
      pin: "123456",
      device_name: "My iPhone",
      platform: "ios",
    });
    expect(outcome).toMatchObject({
      ok: false,
      status: 403,
      code: "PAIRING_CLOSED",
    });
  });

  it("pairs once with code or PIN, consumes the window atomically, and persists only token hashes", async () => {
    let releaseMint!: () => void;
    const mintGate = new Promise<void>((resolve) => {
      releaseMint = resolve;
    });
    const { dir, hostId, manager } = createManager({
      mintSession: async () => {
        await mintGate;
        return {
          sessionCookie: "sess_tok_1",
          sessionMode: "dedicated",
        };
      },
    });

    const window = manager.openPairingWindow();
    expect(window.pair_id).toMatch(/^[0-9a-f]{32}$/u);
    expect(window.pin).toMatch(/^\d{6}$/u);
    expect(window.pair_secret.length).toBeGreaterThanOrEqual(40);

    // Launch two concurrent pairing requests with the same valid secret.
    const req1 = manager.pair({
      code: window.pair_secret,
      device_name: "iPhone 16 Pro",
      platform: "ios",
      app_version: "1.0.0",
    });
    const req2 = manager.pair({
      pin: window.pin,
      device_name: "Attacker Clone",
      platform: "android",
    });

    releaseMint();
    const [res1, res2] = await Promise.all([req1, req2]);

    expect(res1.ok).toBe(true);
    expect(res2).toMatchObject({
      ok: false,
      status: 403,
      code: "PAIRING_CLOSED",
    });

    if (!res1.ok) throw new Error("expected pair success");
    expect(res1.payload).toMatchObject({
      host_id: hostId,
      host_name: "Studio Mac",
      tls_fingerprint: "FP_BASE64URL_43CHARS_0123456789abcdefABCDEF",
      tenant_id: "tenant_abc",
      api_version: 1,
      session_mode: "dedicated",
    });
    expect(res1.payload.token.startsWith("lmc_")).toBe(true);

    // Raw token must never be stored on disk.
    const devicesRaw = readFileSync(path.join(dir, "devices.json"), "utf8");
    expect(devicesRaw).not.toContain(res1.payload.token);
    expect(devicesRaw).toContain(res1.payload.device_id);
    if (process.platform !== "win32") {
      expect(statSync(path.join(dir, "devices.json")).mode & 0o777).toBe(0o600);
      expect(
        statSync(path.join(dir, "device-sessions.json")).mode & 0o777,
      ).toBe(0o600);
    }

    // Authenticates on reload from disk.
    const reloaded = createManager({ dir }).manager;
    const authed = reloaded.authenticateToken(res1.payload.token);
    expect(authed?.device_id).toBe(res1.payload.device_id);
    expect(
      reloaded.authenticateToken("lmc_wrongtoken1234567890"),
    ).toBeUndefined();
  });

  it("expires the pairing window after TTL", async () => {
    let clock = 1_700_000_000_000;
    const { manager } = createManager({ now: () => clock });
    const window = manager.openPairingWindow();
    expect(manager.isPairingOpen()).toBe(true);

    clock += 5 * 60 * 1000 + 1;
    expect(manager.isPairingOpen()).toBe(false);

    const outcome = await manager.pair({
      pin: window.pin,
      device_name: "Pixel",
      platform: "android",
    });
    expect(outcome).toMatchObject({
      ok: false,
      status: 403,
      code: "PAIRING_CLOSED",
    });
  });

  it("locks and destroys the pairing window immediately on the 5th failed attempt", async () => {
    const { manager } = createManager();
    const window = manager.openPairingWindow();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await manager.pair({
        pin: "000000" === window.pin ? "999999" : "000000",
        device_name: "Phone",
        platform: "ios",
      });
      expect(res).toMatchObject({
        ok: false,
        status: 401,
        code: "INVALID_CODE",
      });
      expect(manager.isPairingOpen()).toBe(true);
    }

    const fifth = await manager.pair({
      pin: "000000" === window.pin ? "999999" : "000000",
      device_name: "Phone",
      platform: "ios",
    });
    expect(fifth).toMatchObject({
      ok: false,
      status: 403,
      code: "PAIRING_LOCKED",
    });
    expect(manager.isPairingOpen()).toBe(false);

    // Even the real secret is now rejected because the window was destroyed.
    const afterLock = await manager.pair({
      code: window.pair_secret,
      device_name: "Phone",
      platform: "ios",
    });
    expect(afterLock).toMatchObject({
      ok: false,
      status: 403,
      code: "PAIRING_CLOSED",
    });
  });

  it("rotates tokens, updates sessions, and revokes devices with dedicated logout cleanup", async () => {
    const logoutDedicatedSession = vi.fn(async () => {});
    const onDeviceRevoked = vi.fn();
    const { manager } = createManager({
      sessionMode: "dedicated",
      logoutDedicatedSession,
      onDeviceRevoked,
    });

    const w = manager.openPairingWindow();
    const paired = await manager.pair({
      pin: w.pin,
      device_name: "iPad",
      platform: "ios",
    });
    if (!paired.ok) throw new Error("expected pair success");

    // Rotate invalidates old token and validates new token.
    const rotated = manager.rotateToken(paired.payload.device_id);
    expect(rotated?.token.startsWith("lmc_")).toBe(true);
    expect(manager.authenticateToken(paired.payload.token)).toBeUndefined();
    expect(manager.authenticateToken(rotated!.token)?.device_id).toBe(
      paired.payload.device_id,
    );

    // Update stored session cookie.
    manager.updateDeviceSession(
      paired.payload.device_id,
      "refreshed_cookie_99",
    );
    expect(
      manager.getDeviceSession(paired.payload.device_id)?.session_cookie,
    ).toBe("refreshed_cookie_99");

    // Revoke deletes token, fires callback synchronously, and calls logout for dedicated session.
    expect(manager.revokeDevice(paired.payload.device_id)).toBe(true);
    expect(manager.authenticateToken(rotated!.token)).toBeUndefined();
    expect(onDeviceRevoked).toHaveBeenCalledWith(paired.payload.device_id);
    expect(logoutDedicatedSession).toHaveBeenCalledWith("refreshed_cookie_99");
  });

  it("does not log out desktop session when revoking a delegated device", async () => {
    const logoutDedicatedSession = vi.fn(async () => {});
    const { manager } = createManager({
      sessionMode: "delegated",
      logoutDedicatedSession,
    });
    const w = manager.openPairingWindow();
    const paired = await manager.pair({
      pin: w.pin,
      device_name: "Android",
      platform: "android",
    });
    if (!paired.ok) throw new Error("expected pair success");

    manager.revokeDevice(paired.payload.device_id);
    expect(logoutDedicatedSession).not.toHaveBeenCalled();
  });

  it("formats pairing URIs, compares constant-time values, and extracts cookies", () => {
    const uri = buildPairingUri({
      host: "192.168.1.10",
      port: 48210,
      tls: true,
      fingerprint: "FP_VAL",
      code: "SECRET_CODE",
      name: "My MacBook",
      tailscale: "100.64.0.8",
    });
    expect(uri).toBe(
      "linger://pair?v=1&host=192.168.1.10&port=48210&tls=1&fp=FP_VAL&code=SECRET_CODE&name=My%20MacBook&ts=100.64.0.8",
    );

    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(
      extractSessionFromSetCookie([
        "other=1; Path=/",
        "teamhub_session=tok123; Path=/; HttpOnly",
      ]),
    ).toBe("tok123");
    expect(
      extractSessionFromCookieHeader("foo=bar; teamhub_session=tok456; baz=1"),
    ).toBe("tok456");
  });
});
