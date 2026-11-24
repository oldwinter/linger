import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { Logger } from "../log.js";
import { CompanionGateway } from "./gateway.js";
import { MdnsResponder } from "./mdns.js";
import { discoverAddresses } from "./network.js";
import {
  PairingManager,
  buildPairingUri,
  ensureHostId,
  extractSessionFromCookieHeader,
  extractSessionFromSetCookie,
  type MintedDeviceSession,
} from "./pairing.js";
import { ensureTlsMaterial } from "./tls.js";

export interface StandaloneConfig {
  readonly teamhubUrl: string;
  readonly documentRuntimeUrl: string;
  readonly port: number;
  readonly bindHost: string;
  readonly dataDir: string;
  readonly tls: boolean;
  readonly mdns: boolean;
  readonly customHost?: string;
  readonly hostName: string;
  readonly hostId?: string;
  readonly tenantId?: string;
  readonly computerId?: string;
  readonly email?: string;
  readonly password?: string;
  readonly sessionCookie?: string;
  readonly openPairing: boolean;
  readonly jsonOutput: boolean;
}

export interface StandaloneHandle {
  readonly gateway: CompanionGateway;
  readonly pairing: PairingManager;
  readonly mdns: MdnsResponder;
  readonly port: number;
  readonly hostId: string;
  readonly tlsFingerprint: string;
  readonly shortFingerprint: string;
  readonly pairingPin?: string;
  readonly pairingUri?: string;
  readonly stop: () => Promise<void>;
}

export function parseStandaloneArgs(
  argv: readonly string[],
  defaults: {
    readonly teamhubUrl?: string;
    readonly documentRuntimeUrl?: string;
  } = {},
): StandaloneConfig {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      "teamhub-url": { type: "string" },
      "document-runtime-url": { type: "string" },
      port: { type: "string" },
      bind: { type: "string" },
      "data-dir": { type: "string" },
      tls: { type: "boolean" },
      "no-tls": { type: "boolean" },
      mdns: { type: "boolean" },
      "no-mdns": { type: "boolean" },
      "custom-host": { type: "string" },
      "host-name": { type: "string" },
      "host-id": { type: "string" },
      "tenant-id": { type: "string" },
      "computer-id": { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
      "session-cookie": { type: "string" },
      "open-pairing": { type: "boolean" },
      json: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });

  const port = values.port !== undefined ? Number(values.port) : 48210;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${values.port ?? ""}`);
  }

  const tls = values["no-tls"] ? false : (values.tls ?? true);
  const mdns = values["no-mdns"] ? false : (values.mdns ?? true);

  return {
    teamhubUrl:
      values["teamhub-url"] ??
      defaults.teamhubUrl ??
      process.env.TEAMHUB_BASE_URL ??
      "http://127.0.0.1:8080",
    documentRuntimeUrl:
      values["document-runtime-url"] ??
      defaults.documentRuntimeUrl ??
      process.env.TEAMHUB_DOCUMENT_RUNTIME_URL ??
      "http://127.0.0.1:4321",
    port,
    bindHost: values.bind ?? "0.0.0.0",
    dataDir:
      values["data-dir"] ??
      path.join(os.tmpdir(), "linger-companion-standalone"),
    tls,
    mdns,
    ...(values["custom-host"] ? { customHost: values["custom-host"] } : {}),
    hostName: values["host-name"] ?? os.hostname(),
    ...(values["host-id"] ? { hostId: values["host-id"] } : {}),
    ...(values["tenant-id"] ? { tenantId: values["tenant-id"] } : {}),
    ...(values["computer-id"] ? { computerId: values["computer-id"] } : {}),
    ...(values.email ? { email: values.email } : {}),
    ...(values.password ? { password: values.password } : {}),
    ...(values["session-cookie"]
      ? { sessionCookie: values["session-cookie"] }
      : {}),
    openPairing: values["open-pairing"] ?? false,
    jsonOutput: values.json ?? false,
  };
}

function extractTenantFromLoginBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.tenant_id === "string" && record.tenant_id) {
    return record.tenant_id;
  }
  if (typeof record.active_tenant_id === "string" && record.active_tenant_id) {
    return record.active_tenant_id;
  }
  if (Array.isArray(record.tenants) && record.tenants.length > 0) {
    const first = record.tenants[0] as Record<string, unknown> | undefined;
    if (first && typeof first.id === "string" && first.id) return first.id;
  }
  return undefined;
}

export async function loginForDedicatedSession(
  teamhubUrl: string,
  email: string,
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<MintedDeviceSession | undefined> {
  const response = await fetcher(new URL("/v0/auth/login", teamhubUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ identifier: email, password }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return undefined;
  }
  const cookie = extractSessionFromSetCookie(response.headers.getSetCookie());
  let tenantId: string | undefined;
  try {
    tenantId = extractTenantFromLoginBody(await response.json());
  } catch {
    // Response may omit tenant details; fall back to configured tenantId.
  }
  if (!cookie) return undefined;
  return {
    sessionCookie: cookie,
    sessionMode: "dedicated",
    ...(tenantId ? { tenantId } : {}),
  };
}

export async function logoutDedicatedSession(
  teamhubUrl: string,
  sessionCookie: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(new URL("/v0/auth/logout", teamhubUrl), {
    method: "POST",
    headers: {
      cookie: `teamhub_session=${sessionCookie}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
}

function createStderrLogger(): Logger {
  const write =
    (level: string) =>
    (event: string, fields: Record<string, unknown> = {}): void => {
      process.stderr.write(
        `${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`,
      );
    };
  return { info: write("info"), warn: write("warn"), error: write("error") };
}

export async function startStandaloneGateway(
  config: StandaloneConfig,
  options: {
    readonly log?: Logger;
    readonly desktopVersion?: string;
    readonly fetcher?: typeof fetch;
  } = {},
): Promise<StandaloneHandle> {
  const log = options.log ?? createStderrLogger();
  const fetcher = options.fetcher ?? fetch;
  const hostId = ensureHostId(config.dataDir, config.hostId);
  const tlsMaterial = config.tls
    ? ensureTlsMaterial(config.dataDir, {
        hostname: config.hostName,
        ...(config.customHost ? { customHost: config.customHost } : {}),
      })
    : undefined;

  const gatewayRef: { current?: CompanionGateway } = {};
  const mdns = new MdnsResponder({ log });

  const buildAnnouncement = (listenPort: number) => {
    const addrs = discoverAddresses();
    return {
      hostId,
      hostName: config.hostName,
      port: listenPort,
      tls: config.tls,
      tlsFingerprint: tlsMaterial?.fingerprint ?? "",
      pairingOpen: pairing.isPairingOpen(),
      addresses: addrs.lan.length > 0 ? addrs.lan : ["127.0.0.1"],
    };
  };

  const pairing = new PairingManager({
    directory: config.dataDir,
    hostId,
    getHostName: () => config.hostName,
    getTlsFingerprint: () => tlsMaterial?.fingerprint ?? "",
    getTenantId: () => config.tenantId,
    mintDeviceSession: async () => {
      if (config.email && config.password) {
        const dedicated = await loginForDedicatedSession(
          config.teamhubUrl,
          config.email,
          config.password,
          fetcher,
        );
        if (dedicated) return dedicated;
      }
      if (config.sessionCookie) {
        const raw =
          extractSessionFromCookieHeader(config.sessionCookie) ??
          config.sessionCookie.trim();
        if (raw) {
          return {
            sessionCookie: raw,
            sessionMode: "delegated",
            ...(config.tenantId ? { tenantId: config.tenantId } : {}),
          };
        }
      }
      return undefined;
    },
    logoutDedicatedSession: (cookie) =>
      logoutDedicatedSession(config.teamhubUrl, cookie, fetcher),
    onDeviceRevoked: (deviceId) => {
      gatewayRef.current?.revokeDeviceConnections(deviceId);
    },
    onChanged: () => {
      const p = gatewayRef.current?.port();
      if (config.mdns && p !== undefined) {
        mdns.update(buildAnnouncement(p));
      }
    },
    log,
  });

  const gateway = new CompanionGateway({
    bindHost: config.bindHost,
    port: config.port,
    tls: config.tls,
    ...(tlsMaterial ? { tlsMaterial } : {}),
    pairing,
    hostId,
    getHostName: () => config.hostName,
    desktopVersion: options.desktopVersion ?? "standalone",
    ...(config.customHost ? { customHost: config.customHost } : {}),
    getTeamHubBaseUrl: () => config.teamhubUrl,
    getDocumentRuntimeUrl: () => config.documentRuntimeUrl,
    getStatusSnapshot: () => ({
      computer_id: config.computerId ?? null,
      daemon_connection: "online",
      runtime_state: "ready",
      active_operations: 0,
      prevent_sleep: false,
      local_server_phase: "ready",
      local_models_degraded: false,
      server_url_mode: "local",
    }),
    log,
  });
  gatewayRef.current = gateway;

  const listenPort = await gateway.start();

  let pairingPin: string | undefined;
  let pairingUri: string | undefined;
  if (config.openPairing) {
    const window = pairing.openPairingWindow();
    const addrs = discoverAddresses();
    const primaryHost =
      config.customHost ?? addrs.lan[0] ?? addrs.tailscale[0] ?? "127.0.0.1";
    pairingPin = window.pin;
    pairingUri = buildPairingUri({
      host: primaryHost,
      port: listenPort,
      tls: config.tls,
      fingerprint: tlsMaterial?.fingerprint ?? "",
      code: window.pair_secret,
      name: config.hostName,
      ...(addrs.tailscale[0] ? { tailscale: addrs.tailscale[0] } : {}),
    });
  }

  if (config.mdns) {
    await mdns.start(buildAnnouncement(listenPort));
  }

  return {
    gateway,
    pairing,
    mdns,
    port: listenPort,
    hostId,
    tlsFingerprint: tlsMaterial?.fingerprint ?? "",
    shortFingerprint: tlsMaterial?.shortFingerprint ?? "",
    ...(pairingPin ? { pairingPin } : {}),
    ...(pairingUri ? { pairingUri } : {}),
    stop: async () => {
      await mdns.stop();
      await gateway.stop();
      pairing.flush();
    },
  };
}

async function runCli(): Promise<void> {
  const config = parseStandaloneArgs(process.argv.slice(2));
  const handle = await startStandaloneGateway(config);
  const addrs = discoverAddresses();

  if (config.jsonOutput) {
    process.stdout.write(
      `${JSON.stringify({
        host_id: handle.hostId,
        host_name: config.hostName,
        port: handle.port,
        tls: config.tls,
        tls_fingerprint: handle.tlsFingerprint,
        short_fingerprint: handle.shortFingerprint,
        addresses: { lan: addrs.lan, tailscale: addrs.tailscale },
        ...(handle.pairingPin ? { pairing_pin: handle.pairingPin } : {}),
        ...(handle.pairingUri ? { pairing_uri: handle.pairingUri } : {}),
      })}\n`,
    );
  } else {
    const scheme = config.tls ? "https" : "http";
    process.stdout.write(
      `Linger Mobile Companion Gateway listening on ${scheme}://${config.bindHost}:${handle.port}\n`,
    );
    if (handle.shortFingerprint) {
      process.stdout.write(
        `TLS SPKI Fingerprint: ${handle.shortFingerprint} (${handle.tlsFingerprint})\n`,
      );
    }
    if (handle.pairingPin && handle.pairingUri) {
      process.stdout.write(`Pairing PIN: ${handle.pairingPin}\n`);
      process.stdout.write(`Pairing URI: ${handle.pairingUri}\n`);
    }
  }

  const shutdown = (): void => {
    void handle.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isDirectEntry =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirectEntry) {
  void runCli().catch((error: unknown) => {
    process.stderr.write(`Companion gateway failed: ${String(error)}\n`);
    process.exit(1);
  });
}
