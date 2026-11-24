import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Logger } from "../log.js";

export type DeviceSessionMode = "dedicated" | "delegated";

export interface PairedDeviceRecord {
  readonly device_id: string;
  readonly token_hash: string;
  readonly device_name: string;
  readonly platform: string;
  readonly app_version?: string;
  readonly created_at: string;
  readonly last_seen_at: string;
  readonly session_mode: DeviceSessionMode;
}

export interface DeviceSessionRecord {
  readonly session_cookie: string;
  readonly session_mode: DeviceSessionMode;
  readonly updated_at: string;
}

export interface ActivePairingWindow {
  readonly pair_id: string;
  readonly pair_secret: string;
  readonly pin: string;
  readonly expires_at: number;
  failed_attempts: number;
}

export interface PairingUriParams {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly fingerprint: string;
  readonly code: string;
  readonly name: string;
  readonly tailscale?: string;
}

export interface MintedDeviceSession {
  readonly sessionCookie: string;
  readonly sessionMode: DeviceSessionMode;
  readonly tenantId?: string;
}

export interface PairSuccessPayload {
  readonly device_id: string;
  readonly token: string;
  readonly host_id: string;
  readonly host_name: string;
  readonly tls_fingerprint: string;
  readonly tenant_id: string;
  readonly api_version: 1;
  readonly session_mode: DeviceSessionMode;
}

export type PairErrorCode =
  | "PAIRING_CLOSED"
  | "INVALID_CODE"
  | "PAIRING_LOCKED"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "SESSION_UNAVAILABLE";

export type PairOutcome =
  | { readonly ok: true; readonly payload: PairSuccessPayload }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: PairErrorCode;
      readonly message: string;
    };

export interface PairingManagerOptions {
  readonly directory: string;
  readonly hostId: string;
  readonly getHostName: () => string;
  readonly getTlsFingerprint: () => string;
  readonly getTenantId: () => string | undefined;
  readonly mintDeviceSession: () => Promise<MintedDeviceSession | undefined>;
  readonly logoutDedicatedSession?: (sessionCookie: string) => Promise<void>;
  readonly onDeviceRevoked?: (deviceId: string) => void;
  readonly onChanged?: () => void;
  readonly log?: Logger;
  readonly now?: () => number;
  readonly pairingTtlMs?: number;
  readonly maxAttempts?: number;
  readonly touchFlushMs?: number;
}

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const MAX_PAIRING_ATTEMPTS = 5;
const DEFAULT_TOUCH_FLUSH_MS = 30_000;
const TOKEN_PREFIX = "lmc_";
const DEVICES_FILE = "devices.json";
const SESSIONS_FILE = "device-sessions.json";
const HOST_FILE = "host.json";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

export function buildPairingUri(params: PairingUriParams): string {
  const parts = [
    "v=1",
    `host=${encodeURIComponent(params.host)}`,
    `port=${encodeURIComponent(String(params.port))}`,
    `tls=${params.tls ? "1" : "0"}`,
    `fp=${encodeURIComponent(params.fingerprint)}`,
    `code=${encodeURIComponent(params.code)}`,
    `name=${encodeURIComponent(params.name)}`,
  ];
  if (params.tailscale) {
    parts.push(`ts=${encodeURIComponent(params.tailscale)}`);
  }
  return `linger://pair?${parts.join("&")}`;
}

export function extractSessionFromSetCookie(
  setCookie: string | readonly string[] | undefined,
): string | undefined {
  if (!setCookie) return undefined;
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const header of values) {
    const firstPart = header.split(";", 1)[0]?.trim() ?? "";
    const eqIndex = firstPart.indexOf("=");
    if (eqIndex === -1) continue;
    const name = firstPart.slice(0, eqIndex).trim();
    const val = firstPart.slice(eqIndex + 1).trim();
    if (name === "teamhub_session" && val.length > 0) {
      return val;
    }
  }
  return undefined;
}

export function extractSessionFromCookieHeader(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const segment of cookieHeader.split(";")) {
    const trimmed = segment.trim();
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const name = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (name === "teamhub_session" && val.length > 0) {
      return val;
    }
  }
  return undefined;
}

function writeAtomicPrivateJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
  });
  if (process.platform !== "win32") {
    chmodSync(tempPath, 0o600);
  }
  renameSync(tempPath, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function ensureHostId(directory: string, override?: string): string {
  if (override && override.trim().length > 0) return override.trim();
  const hostPath = path.join(directory, HOST_FILE);
  const existing = readJsonFile<{ host_id?: unknown }>(hostPath, {});
  if (typeof existing.host_id === "string" && existing.host_id.length > 0) {
    return existing.host_id;
  }
  const hostId = randomUUID();
  writeAtomicPrivateJson(hostPath, { host_id: hostId });
  return hostId;
}

interface ParsedPairRequest {
  readonly code?: string;
  readonly pin?: string;
  readonly deviceName: string;
  readonly platform: string;
  readonly appVersion?: string;
}

function parsePairRequest(input: unknown): ParsedPairRequest | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const rawCode =
    typeof record.code === "string" ? record.code.trim() : undefined;
  const rawPin = typeof record.pin === "string" ? record.pin.trim() : undefined;
  const rawName =
    typeof record.device_name === "string" ? record.device_name.trim() : "";
  const rawPlatform =
    typeof record.platform === "string" ? record.platform.trim() : "";
  const rawVersion =
    typeof record.app_version === "string"
      ? record.app_version.trim()
      : undefined;

  if (!rawName || rawName.length > 120 || /\p{Cc}/u.test(rawName)) {
    return undefined;
  }
  if (!rawPlatform || rawPlatform.length > 40 || /\p{Cc}/u.test(rawPlatform)) {
    return undefined;
  }
  if (
    rawVersion !== undefined &&
    (rawVersion.length > 60 || /\p{Cc}/u.test(rawVersion))
  ) {
    return undefined;
  }
  const code = rawCode && rawCode.length > 0 ? rawCode : undefined;
  const pin = rawPin && rawPin.length > 0 ? rawPin : undefined;
  if (!code && !pin) return undefined;
  if (code && code.length > 256) return undefined;
  if (pin && pin.length > 32) return undefined;

  return {
    ...(code ? { code } : {}),
    ...(pin ? { pin } : {}),
    deviceName: rawName,
    platform: rawPlatform,
    ...(rawVersion ? { appVersion: rawVersion } : {}),
  };
}

export class PairingManager {
  readonly #directory: string;
  readonly #hostId: string;
  readonly #options: PairingManagerOptions;
  readonly #now: () => number;
  readonly #pairingTtlMs: number;
  readonly #maxAttempts: number;
  readonly #touchFlushMs: number;
  readonly #devices = new Map<string, PairedDeviceRecord>();
  readonly #sessions = new Map<string, DeviceSessionRecord>();
  #activePairing: ActivePairingWindow | undefined;
  #touchTimer: NodeJS.Timeout | undefined;
  #touchDirty = false;

  constructor(options: PairingManagerOptions) {
    this.#options = options;
    this.#directory = options.directory;
    this.#hostId = options.hostId;
    this.#now = options.now ?? (() => Date.now());
    this.#pairingTtlMs = options.pairingTtlMs ?? PAIRING_TTL_MS;
    this.#maxAttempts = options.maxAttempts ?? MAX_PAIRING_ATTEMPTS;
    this.#touchFlushMs = options.touchFlushMs ?? DEFAULT_TOUCH_FLUSH_MS;
    this.#loadFromDisk();
  }

  hostId(): string {
    return this.#hostId;
  }

  openPairingWindow(): ActivePairingWindow {
    const window: ActivePairingWindow = {
      pair_id: randomBytes(16).toString("hex"),
      pair_secret: randomBytes(32).toString("base64url"),
      pin: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      expires_at: this.#now() + this.#pairingTtlMs,
      failed_attempts: 0,
    };
    this.#activePairing = window;
    this.#options.log?.info("companion.pairing_opened", {
      pair_id: window.pair_id,
      expires_at: new Date(window.expires_at).toISOString(),
    });
    this.#options.onChanged?.();
    return { ...window };
  }

  closePairingWindow(): void {
    if (!this.#activePairing) return;
    const closedId = this.#activePairing.pair_id;
    this.#activePairing = undefined;
    this.#options.log?.info("companion.pairing_closed", { pair_id: closedId });
    this.#options.onChanged?.();
  }

  getActivePairing(): Readonly<ActivePairingWindow> | undefined {
    if (!this.#activePairing) return undefined;
    if (this.#now() >= this.#activePairing.expires_at) {
      const expiredId = this.#activePairing.pair_id;
      this.#activePairing = undefined;
      this.#options.log?.info("companion.pairing_expired", {
        pair_id: expiredId,
      });
      this.#options.onChanged?.();
      return undefined;
    }
    return this.#activePairing;
  }

  isPairingOpen(): boolean {
    return this.getActivePairing() !== undefined;
  }

  listDevices(): readonly PairedDeviceRecord[] {
    return [...this.#devices.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }

  deviceCount(): number {
    return this.#devices.size;
  }

  getDevice(deviceId: string): PairedDeviceRecord | undefined {
    return this.#devices.get(deviceId);
  }

  getDeviceSession(deviceId: string): DeviceSessionRecord | undefined {
    return this.#sessions.get(deviceId);
  }

  async pair(rawInput: unknown): Promise<PairOutcome> {
    const parsed = parsePairRequest(rawInput);
    if (!parsed) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_REQUEST",
        message: "device_name, platform, and either code or pin are required.",
      };
    }

    const active = this.getActivePairing();
    if (!active || !this.#activePairing) {
      return {
        ok: false,
        status: 403,
        code: "PAIRING_CLOSED",
        message: "Pairing is currently closed on this desktop.",
      };
    }

    const codeMatches =
      parsed.code !== undefined
        ? constantTimeEqual(parsed.code, active.pair_secret)
        : undefined;
    const pinMatches =
      parsed.pin !== undefined
        ? constantTimeEqual(parsed.pin, active.pin)
        : undefined;

    const verified =
      (codeMatches === undefined || codeMatches) &&
      (pinMatches === undefined || pinMatches) &&
      (codeMatches === true || pinMatches === true);

    if (!verified) {
      this.#activePairing.failed_attempts += 1;
      const attempts = this.#activePairing.failed_attempts;
      if (attempts >= this.#maxAttempts) {
        this.#activePairing = undefined;
        this.#options.log?.warn("companion.pairing_locked", {
          pair_id: active.pair_id,
          attempts,
        });
        this.#options.onChanged?.();
        return {
          ok: false,
          status: 403,
          code: "PAIRING_LOCKED",
          message:
            "Too many failed pairing attempts; pairing window has been locked and closed.",
        };
      }
      this.#options.log?.warn("companion.pairing_invalid_code", {
        pair_id: active.pair_id,
        attempts,
      });
      return {
        ok: false,
        status: 401,
        code: "INVALID_CODE",
        message: "Invalid pairing code or PIN.",
      };
    }

    // Consume atomically before async session minting so concurrent requests
    // cannot reuse the same single-use window.
    this.#activePairing = undefined;
    this.#options.onChanged?.();

    let minted: MintedDeviceSession | undefined;
    try {
      minted = await this.#options.mintDeviceSession();
    } catch (error) {
      this.#options.log?.warn("companion.session_mint_failed", {
        error: String(error),
      });
      return {
        ok: false,
        status: 503,
        code: "SESSION_UNAVAILABLE",
        message: "Unable to establish a TeamHub session for this device.",
      };
    }

    if (!minted || !minted.sessionCookie) {
      return {
        ok: false,
        status: 503,
        code: "SESSION_UNAVAILABLE",
        message:
          "Sign in to Linger on this desktop before pairing a mobile device.",
      };
    }

    const nowIso = new Date(this.#now()).toISOString();
    const deviceId = randomUUID();
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const deviceRecord: PairedDeviceRecord = {
      device_id: deviceId,
      token_hash: hashToken(token),
      device_name: parsed.deviceName,
      platform: parsed.platform,
      ...(parsed.appVersion ? { app_version: parsed.appVersion } : {}),
      created_at: nowIso,
      last_seen_at: nowIso,
      session_mode: minted.sessionMode,
    };
    const sessionRecord: DeviceSessionRecord = {
      session_cookie: minted.sessionCookie,
      session_mode: minted.sessionMode,
      updated_at: nowIso,
    };

    this.#devices.set(deviceId, deviceRecord);
    this.#sessions.set(deviceId, sessionRecord);
    this.#persistDevices();
    this.#persistSessions();

    this.#options.log?.info("companion.device_paired", {
      device_id: deviceId,
      platform: parsed.platform,
      session_mode: minted.sessionMode,
    });
    this.#options.onChanged?.();

    return {
      ok: true,
      payload: {
        device_id: deviceId,
        token,
        host_id: this.#hostId,
        host_name: this.#options.getHostName(),
        tls_fingerprint: this.#options.getTlsFingerprint(),
        tenant_id: minted.tenantId ?? this.#options.getTenantId() ?? "",
        api_version: 1,
        session_mode: minted.sessionMode,
      },
    };
  }

  authenticateToken(rawToken: string): PairedDeviceRecord | undefined {
    if (!rawToken.startsWith(TOKEN_PREFIX) || rawToken.length < 20) {
      return undefined;
    }
    const candidateHash = createHash("sha256")
      .update(rawToken, "utf8")
      .digest();
    let matched: PairedDeviceRecord | undefined;
    for (const device of this.#devices.values()) {
      const storedHash = Buffer.from(device.token_hash, "hex");
      if (
        storedHash.length === candidateHash.length &&
        timingSafeEqual(candidateHash, storedHash)
      ) {
        matched = device;
      }
    }
    return matched;
  }

  touchDevice(deviceId: string): void {
    const existing = this.#devices.get(deviceId);
    if (!existing) return;
    this.#devices.set(deviceId, {
      ...existing,
      last_seen_at: new Date(this.#now()).toISOString(),
    });
    this.#touchDirty = true;
    if (!this.#touchTimer) {
      this.#touchTimer = setTimeout(() => {
        this.#touchTimer = undefined;
        if (this.#touchDirty) {
          this.#touchDirty = false;
          this.#persistDevices();
        }
      }, this.#touchFlushMs);
      this.#touchTimer.unref();
    }
  }

  rotateToken(
    deviceId: string,
  ): { readonly device_id: string; readonly token: string } | undefined {
    const existing = this.#devices.get(deviceId);
    if (!existing) return undefined;
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const updated: PairedDeviceRecord = {
      ...existing,
      token_hash: hashToken(token),
      last_seen_at: new Date(this.#now()).toISOString(),
    };
    this.#devices.set(deviceId, updated);
    this.#touchDirty = false;
    this.#persistDevices();
    this.#options.log?.info("companion.token_rotated", { device_id: deviceId });
    this.#options.onChanged?.();
    return { device_id: deviceId, token };
  }

  updateDeviceSession(deviceId: string, sessionCookie: string): void {
    const existing = this.#sessions.get(deviceId);
    if (!existing || !sessionCookie) return;
    if (existing.session_cookie === sessionCookie) return;
    this.#sessions.set(deviceId, {
      ...existing,
      session_cookie: sessionCookie,
      updated_at: new Date(this.#now()).toISOString(),
    });
    this.#persistSessions();
    this.#options.log?.info("companion.session_refreshed", {
      device_id: deviceId,
    });
  }

  revokeDevice(deviceId: string): boolean {
    const existed = this.#devices.delete(deviceId);
    const session = this.#sessions.get(deviceId);
    this.#sessions.delete(deviceId);
    if (!existed && !session) return false;

    this.#touchDirty = false;
    this.#persistDevices();
    this.#persistSessions();

    this.#options.onDeviceRevoked?.(deviceId);

    if (
      session &&
      session.session_mode === "dedicated" &&
      this.#options.logoutDedicatedSession
    ) {
      void this.#options
        .logoutDedicatedSession(session.session_cookie)
        .catch((error: unknown) => {
          this.#options.log?.warn("companion.logout_cleanup_failed", {
            device_id: deviceId,
            error: String(error),
          });
        });
    }

    this.#options.log?.info("companion.device_revoked", {
      device_id: deviceId,
    });
    this.#options.onChanged?.();
    return true;
  }

  revokeAllDevices(): number {
    const ids = [...this.#devices.keys()];
    for (const id of ids) {
      this.revokeDevice(id);
    }
    return ids.length;
  }

  flush(): void {
    if (this.#touchTimer) {
      clearTimeout(this.#touchTimer);
      this.#touchTimer = undefined;
    }
    if (this.#touchDirty) {
      this.#touchDirty = false;
      this.#persistDevices();
    }
  }

  #loadFromDisk(): void {
    const devicesPath = path.join(this.#directory, DEVICES_FILE);
    const sessionsPath = path.join(this.#directory, SESSIONS_FILE);

    const rawDevices = readJsonFile<{ devices?: unknown }>(devicesPath, {});
    if (Array.isArray(rawDevices.devices)) {
      for (const item of rawDevices.devices) {
        if (!item || typeof item !== "object") continue;
        const d = item as Record<string, unknown>;
        if (
          typeof d.device_id === "string" &&
          typeof d.token_hash === "string" &&
          /^[0-9a-f]{64}$/iu.test(d.token_hash) &&
          typeof d.device_name === "string" &&
          typeof d.platform === "string" &&
          typeof d.created_at === "string" &&
          typeof d.last_seen_at === "string" &&
          (d.session_mode === "dedicated" || d.session_mode === "delegated")
        ) {
          this.#devices.set(d.device_id, {
            device_id: d.device_id,
            token_hash: d.token_hash,
            device_name: d.device_name,
            platform: d.platform,
            ...(typeof d.app_version === "string"
              ? { app_version: d.app_version }
              : {}),
            created_at: d.created_at,
            last_seen_at: d.last_seen_at,
            session_mode: d.session_mode,
          });
        }
      }
    }

    const rawSessions = readJsonFile<{ sessions?: unknown }>(sessionsPath, {});
    if (
      rawSessions.sessions &&
      typeof rawSessions.sessions === "object" &&
      !Array.isArray(rawSessions.sessions)
    ) {
      for (const [deviceId, value] of Object.entries(
        rawSessions.sessions as Record<string, unknown>,
      )) {
        if (!value || typeof value !== "object") continue;
        const s = value as Record<string, unknown>;
        if (
          typeof s.session_cookie === "string" &&
          s.session_cookie.length > 0 &&
          (s.session_mode === "dedicated" || s.session_mode === "delegated") &&
          typeof s.updated_at === "string"
        ) {
          this.#sessions.set(deviceId, {
            session_cookie: s.session_cookie,
            session_mode: s.session_mode,
            updated_at: s.updated_at,
          });
        }
      }
    }
  }

  #persistDevices(): void {
    writeAtomicPrivateJson(path.join(this.#directory, DEVICES_FILE), {
      devices: [...this.#devices.values()],
    });
  }

  #persistSessions(): void {
    const sessionsObj: Record<string, DeviceSessionRecord> = {};
    for (const [id, session] of this.#sessions.entries()) {
      sessionsObj[id] = session;
    }
    writeAtomicPrivateJson(path.join(this.#directory, SESSIONS_FILE), {
      sessions: sessionsObj,
    });
  }
}
