import os from "node:os";
import path from "node:path";

import {
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeTheme,
  session,
  type IpcMainInvokeEvent,
  type Session,
} from "electron";
import { z } from "zod";

import { readLocalIdentity } from "@linger/local-installation/account";
import { loadInstance } from "@linger/local-installation/instance";

import { localizePage } from "../i18n/page.js";
import messagesHtml from "../shell/messages.html";
import mobileCompanionHtml from "../shell/mobile-companion.html";
import { mobileCompanionMessages } from "../shell/mobile-companion.messages.js";
import type { LanguageModule } from "./language.js";
import {
  MOBILE_COMPANION_IPC,
  type MobileCompanionCommand,
  type MobileCompanionConfigState,
  type MobileCompanionState,
} from "../shared/mobile-companion.js";
import type { ComputerDaemonModule } from "./computer-daemon.js";
import {
  CompanionGateway,
  type CompanionGatewayOptions,
  type CompanionRuntimeStatusSnapshot,
} from "./companion/gateway.js";
import { MdnsResponder } from "./companion/mdns.js";
import { discoverAddresses, normalizeCustomHost } from "./companion/network.js";
import {
  PairingManager,
  buildPairingUri,
  ensureHostId,
  extractSessionFromCookieHeader,
  type MintedDeviceSession,
} from "./companion/pairing.js";
import { renderQrSvg } from "./companion/qr.js";
import {
  loginForDedicatedSession,
  logoutDedicatedSession,
} from "./companion/standalone.js";
import { ensureTlsMaterial, type TlsMaterial } from "./companion/tls.js";
import type { MobileCompanionConfig } from "./config.js";
import type { HerdrCoreBridgeModule } from "./herdr-core/module.js";
import {
  LOCAL_INSTANCE,
  proveLocalServer,
  type LocalServerModule,
} from "./local-server.js";
import type { Logger } from "./log.js";
import type { Module, ModuleContext } from "./modules.js";
import { sameOrigin } from "./navigation.js";
import type { PowerGuardModule } from "./power-guard.js";
import type { StatusModule } from "./status.js";

export const MOBILE_COMPANION_URL = "app://mobile-companion/";
const PARTITION = "linger-mobile-companion";

export const DEFAULT_COMPANION_CONFIG: MobileCompanionConfigState = {
  enabled: false,
  port: 48210,
  advertiseMdns: true,
  tls: true,
};

export interface MobileCompanionOptions {
  readonly preload: string;
  readonly userData: string;
  readonly version: string;
  readonly defaultHostName?: string;
  readonly localServer?: LocalServerModule;
  readonly status?: StatusModule;
  readonly daemon?: ComputerDaemonModule;
  readonly power?: PowerGuardModule;
  readonly herdrCoreBridge?: HerdrCoreBridgeModule;
  readonly sessionCookie: (serverUrl: string) => Promise<string | undefined>;
  readonly fetcher?: typeof fetch;
  readonly gatewayFactory?: (
    options: CompanionGatewayOptions,
  ) => CompanionGateway;
  readonly mdnsFactory?: (log?: Logger) => MdnsResponder;
}

const commandSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("config.update"),
    patch: z.object({
      enabled: z.boolean().optional(),
      port: z.number().int().min(1024).max(65535).optional(),
      advertiseMdns: z.boolean().optional(),
      tls: z.boolean().optional(),
      customHost: z.string().trim().max(255).nullable().optional(),
    }),
  }),
  z.object({ op: z.literal("pairing.open") }),
  z.object({ op: z.literal("pairing.close") }),
  z.object({ op: z.literal("pairing.copyUri") }),
  z.object({
    op: z.literal("device.revoke"),
    deviceId: z.string().min(1).max(128),
  }),
  z.object({ op: z.literal("device.revokeAll") }),
]);

interface ResolvedLocalEndpoints {
  readonly origin: string;
  readonly root: string;
  readonly teamhubUrl: string;
  readonly documentRuntimeUrl: string;
}

function isLoopbackUrl(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export class MobileCompanionModule implements Module {
  readonly name = "MobileCompanion";
  readonly dependsOn = [
    "Config",
    "Language",
    "LocalServer",
    "Status",
    "ComputerDaemon",
    "PowerGuard",
  ];

  readonly #options: MobileCompanionOptions;
  readonly #companionDir: string;
  readonly #fetcher: typeof fetch;
  #ctx: ModuleContext | undefined;
  #window: BrowserWindow | undefined;
  #hostId = "";
  #tlsMaterial: TlsMaterial | undefined;
  #pairing: PairingManager | undefined;
  #gateway: CompanionGateway | undefined;
  #mdns: MdnsResponder | undefined;
  #localEndpoints: ResolvedLocalEndpoints | undefined;
  #lastError: string | undefined;
  #pairingExpiryTimer: NodeJS.Timeout | undefined;
  readonly #unsubscribe: (() => void)[] = [];

  constructor(options: MobileCompanionOptions) {
    this.#options = options;
    this.#companionDir = path.join(options.userData, "companion");
    this.#fetcher = options.fetcher ?? fetch;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
    this.#hostId = ensureHostId(this.#companionDir);
    await this.#refreshLocalEndpoints();

    this.#pairing = new PairingManager({
      directory: this.#companionDir,
      hostId: this.#hostId,
      getHostName: () => this.#hostName(),
      getTlsFingerprint: () => this.#tlsMaterial?.fingerprint ?? "",
      getTenantId: () => this.#ctx?.config.get().tenantId,
      mintDeviceSession: () => this.#mintDeviceSession(),
      logoutDedicatedSession: async (cookie) => {
        const teamhubUrl = this.#teamHubBaseUrl();
        if (!teamhubUrl) return;
        await logoutDedicatedSession(teamhubUrl, cookie, this.#fetcher);
      },
      onDeviceRevoked: (deviceId) => {
        this.#gateway?.revokeDeviceConnections(deviceId);
      },
      onChanged: () => {
        this.#syncPairingTimer();
        this.#updateMdnsAnnouncement();
        this.#pushState();
      },
      log: ctx.log,
    });

    const pages = this.#session();
    pages.protocol.handle("app", (request) => this.#serve(request));

    const fromCompanion = (event: IpcMainInvokeEvent): void => {
      if (
        event.sender !== this.#window?.webContents ||
        !event.senderFrame?.url.startsWith(MOBILE_COMPANION_URL)
      ) {
        throw new Error("Not allowed");
      }
    };

    ipcMain.handle(MOBILE_COMPANION_IPC.state, (event) => {
      fromCompanion(event);
      return this.state();
    });

    ipcMain.handle(
      MOBILE_COMPANION_IPC.run,
      async (event, rawCommand: unknown) => {
        fromCompanion(event);
        const parsed = commandSchema.parse(
          rawCommand,
        ) as MobileCompanionCommand;
        await this.#runCommand(parsed);
        return this.state();
      },
    );

    const onLocalChanged = (): void => {
      void this.#refreshLocalEndpoints().then(() => this.#pushState());
    };

    this.#unsubscribe.push(
      () => ipcMain.removeHandler(MOBILE_COMPANION_IPC.state),
      () => ipcMain.removeHandler(MOBILE_COMPANION_IPC.run),
      () => pages.protocol.unhandle("app"),
      ctx.bus.on("local-server.changed", onLocalChanged),
      ctx.bus.on("server.changed", onLocalChanged),
      ctx.bus.on("computer.renamed", () => {
        this.#updateMdnsAnnouncement();
        this.#pushState();
      }),
      ctx.bus.on("language.changed", () => {
        const win = this.#window;
        if (!win || win.isDestroyed()) return;
        const lang = ctx.get<LanguageModule>("Language");
        win.setTitle(lang.t(mobileCompanionMessages.title));
        void win.loadURL(MOBILE_COMPANION_URL).catch(() => undefined);
      }),
    );

    if (this.#config().enabled) {
      await this.#startGateway();
    }
  }

  async stop(): Promise<void> {
    for (const off of this.#unsubscribe.splice(0)) off();
    this.#clearPairingTimer();
    this.#pairing?.closePairingWindow();
    await this.#stopGateway();
    this.#pairing?.flush();
    this.#window?.destroy();
    this.#window = undefined;
  }

  show(): void {
    if (this.#window && !this.#window.isDestroyed()) {
      this.#window.show();
      this.#window.focus();
      return;
    }

    const title =
      this.#ctx
        ?.get<LanguageModule>("Language")
        .t(mobileCompanionMessages.title) ?? "Mobile Companion";
    const window = new BrowserWindow({
      width: 560,
      height: 740,
      minWidth: 460,
      minHeight: 540,
      show: false,
      title,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#141413" : "#fcfcfa",
      ...(process.platform === "darwin" ? {} : { autoHideMenuBar: true }),
      webPreferences: {
        preload: this.#options.preload,
        session: this.#session(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    const contents = window.webContents;
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });
    window.on("closed", () => {
      if (this.#window === window) this.#window = undefined;
    });
    this.#window = window;
    void window.loadURL(MOBILE_COMPANION_URL).catch(() => undefined);
  }

  state(): MobileCompanionState {
    const cfg = this.#config();
    const addresses = discoverAddresses();
    const listenPort = this.#gateway?.port();
    const activePairing = this.#pairing?.getActivePairing();

    let pairingState: MobileCompanionState["pairing"];
    if (activePairing && listenPort !== undefined) {
      const pairingUri = this.#buildPairingUri(
        activePairing.pair_secret,
        listenPort,
        cfg,
        addresses,
      );
      pairingState = {
        pairId: activePairing.pair_id,
        pin: activePairing.pin,
        pairingUri,
        qrSvg: renderQrSvg(pairingUri),
        expiresAt: activePairing.expires_at,
      };
    }

    const devices = (this.#pairing?.listDevices() ?? []).map((device) => {
      const live = this.#gateway?.activeConnectionsForDevice(device.device_id);
      return {
        deviceId: device.device_id,
        deviceName: device.device_name,
        platform: device.platform,
        ...(device.app_version ? { appVersion: device.app_version } : {}),
        createdAt: device.created_at,
        lastSeenAt: device.last_seen_at,
        sessionMode: device.session_mode,
        activeSse: (live?.sse ?? 0) > 0,
        activeConnections: live?.total ?? 0,
      };
    });

    return {
      running: this.#gateway?.running() ?? false,
      ...(this.#lastError ? { error: this.#lastError } : {}),
      hostId: this.#hostId,
      hostName: this.#hostName(),
      desktopVersion: this.#options.version,
      tlsFingerprint: this.#tlsMaterial?.fingerprint ?? "",
      shortFingerprint: this.#tlsMaterial?.shortFingerprint ?? "",
      addresses: {
        lan: addresses.lan,
        tailscale: addresses.tailscale,
      },
      ...(listenPort !== undefined ? { listenPort } : {}),
      mdnsActive: this.#mdns?.active() ?? false,
      config: cfg,
      ...(pairingState ? { pairing: pairingState } : {}),
      devices,
    };
  }

  async #runCommand(command: MobileCompanionCommand): Promise<void> {
    switch (command.op) {
      case "config.update": {
        const current = this.#config();
        const customHost =
          command.patch.customHost === undefined
            ? current.customHost
            : command.patch.customHost === null ||
                command.patch.customHost.trim() === ""
              ? undefined
              : normalizeCustomHost(command.patch.customHost);
        const next: MobileCompanionConfig = {
          enabled: command.patch.enabled ?? current.enabled,
          port: command.patch.port ?? current.port,
          advertiseMdns: command.patch.advertiseMdns ?? current.advertiseMdns,
          tls: command.patch.tls ?? current.tls,
          ...(customHost ? { customHost } : {}),
        };
        this.#ctx?.config.update({ mobileCompanion: next });
        await this.#reconcileGateway();
        this.#pushState();
        return;
      }
      case "pairing.open": {
        if (!this.#gateway?.running()) {
          throw new Error(
            this.#ctx
              ?.get<LanguageModule>("Language")
              .t(mobileCompanionMessages.errEnableBeforePairing) ??
              "Enable Mobile Companion before opening pairing.",
          );
        }
        this.#pairing?.openPairingWindow();
        return;
      }
      case "pairing.close": {
        this.#pairing?.closePairingWindow();
        return;
      }
      case "pairing.copyUri": {
        const current = this.state();
        if (!current.pairing?.pairingUri) {
          throw new Error(
            this.#ctx
              ?.get<LanguageModule>("Language")
              .t(mobileCompanionMessages.errPairingNotOpen) ??
              "Pairing is not currently open.",
          );
        }
        clipboard.writeText(current.pairing.pairingUri);
        return;
      }
      case "device.revoke": {
        this.#pairing?.revokeDevice(command.deviceId);
        return;
      }
      case "device.revokeAll": {
        this.#pairing?.revokeAllDevices();
        return;
      }
    }
  }

  async #reconcileGateway(): Promise<void> {
    const cfg = this.#config();
    if (!cfg.enabled) {
      this.#pairing?.closePairingWindow();
      await this.#stopGateway();
      this.#lastError = undefined;
      return;
    }
    await this.#stopGateway();
    await this.#startGateway();
  }

  async #startGateway(): Promise<void> {
    const cfg = this.#config();
    this.#lastError = undefined;
    if (cfg.tls) {
      this.#tlsMaterial = ensureTlsMaterial(this.#companionDir, {
        hostname: os.hostname(),
        ...(cfg.customHost ? { customHost: cfg.customHost } : {}),
      });
    }

    const gatewayOptions: CompanionGatewayOptions = {
      port: cfg.port,
      tls: cfg.tls,
      ...(this.#tlsMaterial && cfg.tls
        ? { tlsMaterial: this.#tlsMaterial }
        : {}),
      pairing: this.#pairing!,
      hostId: this.#hostId,
      getHostName: () => this.#hostName(),
      desktopVersion: this.#options.version,
      ...(cfg.customHost ? { customHost: cfg.customHost } : {}),
      getTeamHubBaseUrl: () => this.#teamHubBaseUrl(),
      getDocumentRuntimeUrl: () => this.#documentRuntimeUrl(),
      getStatusSnapshot: () => this.#runtimeStatusSnapshot(),
      ...(this.#options.herdrCoreBridge
        ? {
            getHerdrCoreBridge: () => {
              try {
                return this.#options.herdrCoreBridge?.bridge();
              } catch {
                return undefined;
              }
            },
          }
        : {}),
      onConnectionsChanged: () => this.#pushState(),
      log: this.#ctx?.log,
    };

    const gateway = this.#options.gatewayFactory
      ? this.#options.gatewayFactory(gatewayOptions)
      : new CompanionGateway(gatewayOptions);

    try {
      await gateway.start();
      this.#gateway = gateway;
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#ctx?.log.warn("companion.start_failed", {
        port: cfg.port,
        error: this.#lastError,
      });
      return;
    }

    if (cfg.advertiseMdns) {
      const mdns = this.#options.mdnsFactory
        ? this.#options.mdnsFactory(this.#ctx?.log)
        : new MdnsResponder({ log: this.#ctx?.log });
      this.#mdns = mdns;
      const announcement = this.#buildMdnsAnnouncement();
      if (announcement) {
        await mdns.start(announcement);
      }
    }
  }

  async #stopGateway(): Promise<void> {
    if (this.#mdns) {
      const mdns = this.#mdns;
      this.#mdns = undefined;
      await mdns.stop();
    }
    if (this.#gateway) {
      const gw = this.#gateway;
      this.#gateway = undefined;
      await gw.stop();
    }
  }

  #buildMdnsAnnouncement() {
    const port = this.#gateway?.port();
    if (port === undefined) return undefined;
    const cfg = this.#config();
    const addresses = discoverAddresses();
    return {
      hostId: this.#hostId,
      hostName: this.#hostName(),
      port,
      tls: cfg.tls,
      tlsFingerprint: cfg.tls ? (this.#tlsMaterial?.fingerprint ?? "") : "",
      pairingOpen: this.#pairing?.isPairingOpen() ?? false,
      addresses: addresses.lan.length > 0 ? addresses.lan : ["127.0.0.1"],
    };
  }

  #updateMdnsAnnouncement(): void {
    const announcement = this.#buildMdnsAnnouncement();
    if (announcement && this.#mdns?.active()) {
      this.#mdns.update(announcement);
    }
  }

  #buildPairingUri(
    code: string,
    port: number,
    cfg: MobileCompanionConfigState,
    addresses: ReturnType<typeof discoverAddresses>,
  ): string {
    const host =
      cfg.customHost ??
      addresses.lan[0] ??
      addresses.tailscale[0] ??
      "127.0.0.1";
    const tailscale =
      addresses.tailscale[0] && addresses.tailscale[0] !== host
        ? addresses.tailscale[0]
        : undefined;
    return buildPairingUri({
      host,
      port,
      tls: cfg.tls,
      fingerprint: cfg.tls ? (this.#tlsMaterial?.fingerprint ?? "") : "",
      code,
      name: this.#hostName(),
      ...(tailscale ? { tailscale } : {}),
    });
  }

  #config(): MobileCompanionConfigState {
    const stored = this.#ctx?.config.get().mobileCompanion;
    return {
      enabled: stored?.enabled ?? DEFAULT_COMPANION_CONFIG.enabled,
      port: stored?.port ?? DEFAULT_COMPANION_CONFIG.port,
      advertiseMdns:
        stored?.advertiseMdns ?? DEFAULT_COMPANION_CONFIG.advertiseMdns,
      tls: stored?.tls ?? DEFAULT_COMPANION_CONFIG.tls,
      ...(stored?.customHost ? { customHost: stored.customHost } : {}),
    };
  }

  #hostName(): string {
    return (
      this.#ctx?.config.get().displayName ||
      this.#options.defaultHostName ||
      os.hostname()
    );
  }

  #localServer(): LocalServerModule | undefined {
    if (this.#options.localServer) return this.#options.localServer;
    try {
      return this.#ctx?.get<LocalServerModule>("LocalServer");
    } catch {
      return undefined;
    }
  }

  #daemon(): ComputerDaemonModule | undefined {
    if (this.#options.daemon) return this.#options.daemon;
    try {
      return this.#ctx?.get<ComputerDaemonModule>("ComputerDaemon");
    } catch {
      return undefined;
    }
  }

  #power(): PowerGuardModule | undefined {
    if (this.#options.power) return this.#options.power;
    try {
      return this.#ctx?.get<PowerGuardModule>("PowerGuard");
    } catch {
      return undefined;
    }
  }

  async #refreshLocalEndpoints(): Promise<void> {
    const local = this.#localServer();
    if (!local) {
      this.#localEndpoints = undefined;
      return;
    }
    try {
      const home = local.status().location.path;
      const instance = await loadInstance({ name: LOCAL_INSTANCE, home });
      const ports = instance?.source?.ports;
      if (instance && ports) {
        this.#localEndpoints = {
          origin: instance.origin,
          root: instance.root,
          teamhubUrl: `http://127.0.0.1:${ports.teamhub}`,
          documentRuntimeUrl: `http://127.0.0.1:${ports.document}`,
        };
      } else {
        this.#localEndpoints = undefined;
      }
    } catch {
      this.#localEndpoints = undefined;
    }
  }

  #usingLocalServer(): boolean {
    const endpoints = this.#localEndpoints;
    if (!endpoints) return false;
    const serverUrl = this.#ctx?.config.get().serverUrl;
    if (!serverUrl) return true;
    return sameOrigin(endpoints.origin, serverUrl);
  }

  #teamHubBaseUrl(): string | undefined {
    if (this.#usingLocalServer() && this.#localEndpoints) {
      return this.#localEndpoints.teamhubUrl;
    }
    return this.#ctx?.config.get().serverUrl;
  }

  #documentRuntimeUrl(): string | undefined {
    if (this.#usingLocalServer() && this.#localEndpoints) {
      return this.#localEndpoints.documentRuntimeUrl;
    }
    return this.#ctx?.config.get().serverUrl;
  }

  async #mintDeviceSession(): Promise<MintedDeviceSession | undefined> {
    await this.#refreshLocalEndpoints();
    const local = this.#localServer();
    const endpoints = this.#localEndpoints;

    if (local && endpoints && this.#usingLocalServer()) {
      try {
        const account = await local.account();
        const identity = await readLocalIdentity({ root: endpoints.root });
        await proveLocalServer(
          { origin: endpoints.origin, ...identity },
          this.#fetcher,
        );
        const dedicated = await loginForDedicatedSession(
          endpoints.teamhubUrl,
          account.email,
          account.password,
          this.#fetcher,
        );
        if (dedicated) return dedicated;
        this.#ctx?.log.warn("companion.local_dedicated_login_failed", {
          reason: "missing_session_cookie",
        });
      } catch (error) {
        this.#ctx?.log.warn("companion.local_identity_or_login_failed", {
          error: String(error),
        });
      }
      // Fail closed in local-server mode: never delegate the Desktop web
      // session cookie when local identity proof or dedicated login fails.
      return undefined;
    }

    // Delegated session fallback is reserved strictly for explicit remote-server mode.
    const serverUrl = this.#ctx?.config.get().serverUrl;
    if (!serverUrl) return undefined;
    const cookieHeader = await this.#options.sessionCookie(serverUrl);
    const value = extractSessionFromCookieHeader(cookieHeader);
    if (!value) return undefined;
    return {
      sessionCookie: value,
      sessionMode: "delegated",
      ...(this.#ctx?.config.get().tenantId
        ? { tenantId: this.#ctx.config.get().tenantId }
        : {}),
    };
  }

  #runtimeStatusSnapshot(): CompanionRuntimeStatusSnapshot {
    const config = this.#ctx?.config.get();
    const daemon = this.#daemon();
    const power = this.#power();
    const local = this.#localServer()?.status();
    const serverUrl = config?.serverUrl;
    const serverUrlMode = !serverUrl
      ? "unconfigured"
      : this.#usingLocalServer() || isLoopbackUrl(serverUrl)
        ? "local"
        : "remote";

    return {
      computer_id: config?.computerId ?? null,
      daemon_connection: daemon?.connection() ?? "disconnected",
      runtime_state: daemon?.state() ?? "stopped",
      active_operations: daemon?.running() ?? 0,
      prevent_sleep: power?.alwaysOn() ?? config?.preventSleep ?? false,
      local_server_phase: local?.phase ?? "idle",
      local_models_degraded: Boolean(local?.localModelsDegraded),
      server_url_mode: serverUrlMode,
    };
  }

  #syncPairingTimer(): void {
    this.#clearPairingTimer();
    const active = this.#pairing?.getActivePairing();
    if (!active) return;
    const delay = Math.max(50, active.expires_at - Date.now() + 25);
    this.#pairingExpiryTimer = setTimeout(() => {
      this.#pairingExpiryTimer = undefined;
      // Calling getActivePairing() triggers expiry cleanup & notifications.
      this.#pairing?.getActivePairing();
      this.#updateMdnsAnnouncement();
      this.#pushState();
    }, delay);
    this.#pairingExpiryTimer.unref();
  }

  #clearPairingTimer(): void {
    if (this.#pairingExpiryTimer) {
      clearTimeout(this.#pairingExpiryTimer);
      this.#pairingExpiryTimer = undefined;
    }
  }

  #pushState(): void {
    const contents = this.#window?.webContents;
    if (contents && !contents.isDestroyed()) {
      contents.send(MOBILE_COMPANION_IPC.stateEvent, this.state());
    }
  }

  #session(): Session {
    return session.fromPartition(PARTITION);
  }

  #serve(request: Request): Response {
    if (new URL(request.url).host !== "mobile-companion") {
      return new Response(null, { status: 404 });
    }
    const language =
      this.#ctx?.get<LanguageModule>("Language").current() ?? "en";
    const page = localizePage(
      mobileCompanionHtml,
      messagesHtml,
      mobileCompanionMessages,
      language,
    );
    return new Response(page, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
