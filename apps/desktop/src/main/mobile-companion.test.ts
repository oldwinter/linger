import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageModule } from "./language.js";
import {
  MOBILE_COMPANION_IPC,
  type MobileCompanionState,
} from "../shared/mobile-companion.js";
import { MdnsResponder } from "./companion/mdns.js";
import { parseStandaloneArgs } from "./companion/standalone.js";

const fake = vi.hoisted(() => {
  interface MockEvent {
    readonly sender?: unknown;
    readonly senderFrame?: { readonly url: string } | null;
  }
  type Handler = (event: MockEvent, ...args: unknown[]) => unknown;

  const handlers = new Map<string, Handler>();
  const protocolHandlers = new Map<string, (req: Request) => Response>();
  const pages = {
    protocol: {
      handle: (scheme: string, fn: (req: Request) => Response) =>
        protocolHandlers.set(scheme, fn),
      unhandle: (scheme: string) => protocolHandlers.delete(scheme),
    },
  };
  const windows: FakeWindow[] = [];
  const clipboardWrites: string[] = [];
  const localInstanceRef: {
    current: {
      origin: string;
      root: string;
      source: { ports: { teamhub: number; document: number } };
    } | null;
  } = { current: null };
  const localIdentityRef: {
    current: { instanceId: string; secret: string } | null;
  } = { current: null };

  class FakeWindow {
    readonly options: Record<string, unknown>;
    readonly sent: { channel: string; payload: unknown }[] = [];
    readonly webContents = {
      on: () => {},
      setWindowOpenHandler: () => {},
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        this.sent.push({ channel, payload });
      },
    };
    readonly events = new Map<string, () => void>();
    loadURL = vi.fn(async () => {});
    setTitle = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    close = vi.fn(() => this.events.get("closed")?.());
    destroy = vi.fn();
    isDestroyed = vi.fn(() => false);

    constructor(options: Record<string, unknown>) {
      this.options = options;
      windows.push(this);
    }

    once(name: string, listener: () => void): void {
      this.events.set(name, listener);
    }

    on(name: string, listener: () => void): void {
      this.events.set(name, listener);
    }
  }

  return {
    handlers,
    protocolHandlers,
    pages,
    windows,
    clipboardWrites,
    localInstanceRef,
    localIdentityRef,
    FakeWindow,
  };
});

vi.mock("@linger/local-installation/instance", () => ({
  loadInstance: async () => fake.localInstanceRef.current,
}));
vi.mock("@linger/local-installation/account", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@linger/local-installation/account")>();
  return {
    ...actual,
    readLocalIdentity: async () => {
      if (fake.localIdentityRef.current) return fake.localIdentityRef.current;
      throw new Error("no local identity");
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: fake.FakeWindow,
  clipboard: {
    writeText: (text: string) => fake.clipboardWrites.push(text),
  },
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown,
    ) => fake.handlers.set(channel, handler),
    removeHandler: (channel: string) => fake.handlers.delete(channel),
  },
  session: { fromPartition: () => fake.pages },
}));
vi.mock("../shell/messages.html", () => ({
  default: "<script>const t=(n)=>n;</script>",
}));
vi.mock("../shell/mobile-companion.html", () => ({
  default:
    '<!doctype html><html lang="en"><body><h1 data-t="title">Mobile Companion</h1><script>void 0;</script></body></html>',
}));

const { MOBILE_COMPANION_URL, MobileCompanionModule } =
  await import("./mobile-companion.js");
const { stubModule, tempDirectory, testHost } =
  await import("./test-support.js");

beforeEach(() => {
  fake.handlers.clear();
  fake.protocolHandlers.clear();
  fake.windows.length = 0;
  fake.clipboardWrites.length = 0;
  fake.localInstanceRef.current = null;
  fake.localIdentityRef.current = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function createFixture(
  options: {
    readonly serverUrl?: string;
    readonly sessionCookie?: (serverUrl: string) => Promise<string | undefined>;
    readonly fetcher?: typeof fetch;
  } = {},
) {
  const userData = tempDirectory();
  const mdns = {
    active: vi.fn(() => false),
    start: vi.fn(async () => false),
    update: vi.fn(),
    stop: vi.fn(async () => {}),
  } as unknown as MdnsResponder;

  const module = new MobileCompanionModule({
    preload: "/preload/mobile-companion.cjs",
    userData,
    version: "0.16.20",
    defaultHostName: "Dev Mac",
    sessionCookie:
      options.sessionCookie ?? (async () => "teamhub_session=web_cookie_123"),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    mdnsFactory: () => mdns,
  });

  const localServerStub = Object.assign(stubModule("LocalServer"), {
    status: () => ({
      phase: "idle",
      location: { path: tempDirectory(), custom: false },
    }),
    account: async () => ({
      email: "local@linger.test",
      password: "local-password-123",
    }),
  });
  const daemonStub = Object.assign(stubModule("ComputerDaemon"), {
    state: () => "ready",
    connection: () => "online",
    running: () => 1,
  });
  const powerStub = Object.assign(stubModule("PowerGuard"), {
    alwaysOn: () => false,
  });

  const language = new LanguageModule({ systemLanguages: () => ["en"] });
  const host = testHost(
    [
      stubModule("Config"),
      language,
      localServerStub,
      stubModule("Status"),
      daemonStub,
      powerStub,
      module,
    ],
    {
      serverUrl: options.serverUrl ?? "http://127.0.0.1:3000",
      tenantId: "tenant_1",
      computerId: "comp_1",
    },
  );
  await host.start();
  module.show();
  const window = fake.windows[fake.windows.length - 1]!;

  const invokeState = (sender: unknown = window.webContents) =>
    fake.handlers.get(MOBILE_COMPANION_IPC.state)!({
      sender,
      senderFrame: { url: MOBILE_COMPANION_URL },
    }) as MobileCompanionState;

  const invokeRun = (command: unknown, sender: unknown = window.webContents) =>
    fake.handlers.get(MOBILE_COMPANION_IPC.run)!(
      {
        sender,
        senderFrame: { url: MOBILE_COMPANION_URL },
      },
      command,
    ) as Promise<MobileCompanionState>;

  return { host, module, language, window, mdns, invokeState, invokeRun };
}

describe("MobileCompanionModule", () => {
  it("stays disabled by default, rejects untrusted IPC senders, and serves isolated HTML", async () => {
    const f = await createFixture();
    try {
      const initial = f.invokeState();
      expect(initial.running).toBe(false);
      expect(initial.config.enabled).toBe(false);
      expect(initial.config.port).toBe(48210);
      expect(initial.config.tls).toBe(true);
      expect(initial.config.advertiseMdns).toBe(true);
      expect(initial.devices).toEqual([]);

      expect(() => f.invokeState({})).toThrow("Not allowed");
      await expect(f.invokeRun({ op: "pairing.open" }, {})).rejects.toThrow(
        "Not allowed",
      );

      const appHandler = fake.protocolHandlers.get("app")!;
      const okRes = appHandler(new Request(MOBILE_COMPANION_URL));
      expect(okRes.status).toBe(200);
      expect(await okRes.text()).toContain("Mobile Companion");
      expect(appHandler(new Request("app://other/")).status).toBe(404);

      // Switching Desktop language updates window title, reloads URL, and serves zh-CN catalog.
      f.window.loadURL.mockClear();
      f.window.setTitle.mockClear();
      f.language.choose("zh-CN");
      expect(f.window.setTitle).toHaveBeenCalledTimes(1);
      expect(f.window.setTitle.mock.calls[0]?.[0]).not.toBe("Mobile Companion");
      expect(f.window.loadURL).toHaveBeenCalledWith(MOBILE_COMPANION_URL);
      const zhRes = appHandler(new Request(MOBILE_COMPANION_URL));
      const zhHtml = await zhRes.text();
      expect(zhHtml).toContain('<html lang="zh-CN"');
      expect(zhHtml).toContain("linger-messages");
    } finally {
      await f.host.stop("quit");
    }
  });

  it("enables gateway, opens pairing with QR SVG + PIN, copies URI, and disables cleanly", async () => {
    const f = await createFixture();
    try {
      // Pick a high test port and enable gateway.
      const randomPort = 49152 + Math.floor(Math.random() * 10000);
      const enabled = await f.invokeRun({
        op: "config.update",
        patch: {
          enabled: true,
          port: randomPort,
          tls: true,
          advertiseMdns: false,
          customHost: "mac.tailnet.ts.net",
        },
      });
      expect(enabled.running).toBe(true);
      expect(enabled.listenPort).toBe(randomPort);
      expect(enabled.config.customHost).toBe("mac.tailnet.ts.net");
      expect(enabled.tlsFingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(enabled.shortFingerprint).toMatch(
        /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/u,
      );

      // Open pairing window and verify QR SVG, PIN, and URI format.
      const opened = await f.invokeRun({ op: "pairing.open" });
      expect(opened.pairing).toBeDefined();
      expect(opened.pairing!.pin).toMatch(/^\d{6}$/u);
      expect(opened.pairing!.pairingUri).toContain(
        `linger://pair?v=1&host=mac.tailnet.ts.net&port=${randomPort}&tls=1&fp=${opened.tlsFingerprint}`,
      );
      expect(opened.pairing!.qrSvg).toMatch(/^<svg /u);

      // Copy URI writes to clipboard from main process.
      await f.invokeRun({ op: "pairing.copyUri" });
      expect(fake.clipboardWrites).toEqual([opened.pairing!.pairingUri]);

      // Close pairing window.
      const closed = await f.invokeRun({ op: "pairing.close" });
      expect(closed.pairing).toBeUndefined();

      // Disable gateway cleanly.
      const disabled = await f.invokeRun({
        op: "config.update",
        patch: { enabled: false },
      });
      expect(disabled.running).toBe(false);
    } finally {
      await f.host.stop("quit");
    }
  });

  it("parses standalone CLI flags cleanly", () => {
    const cfg = parseStandaloneArgs([
      "--teamhub-url",
      "http://127.0.0.1:8080",
      "--document-runtime-url",
      "http://127.0.0.1:4321",
      "--port",
      "48299",
      "--no-tls",
      "--no-mdns",
      "--open-pairing",
      "--json",
      "--custom-host",
      "box.ts.net",
    ]);
    expect(cfg).toMatchObject({
      teamhubUrl: "http://127.0.0.1:8080",
      documentRuntimeUrl: "http://127.0.0.1:4321",
      port: 48299,
      tls: false,
      mdns: false,
      openPairing: true,
      jsonOutput: true,
      customHost: "box.ts.net",
    });
  });

  it("fails closed without delegating desktop cookie when local server identity proof fails", async () => {
    fake.localInstanceRef.current = {
      origin: "http://127.0.0.1:3000",
      root: "/tmp/linger-local-test",
      source: { ports: { teamhub: 3001, document: 3002 } },
    };
    fake.localIdentityRef.current = {
      instanceId: "inst_1",
      secret: "secret_1",
    };

    const sessionCookieSpy = vi.fn(
      async () => "teamhub_session=desktop_web_cookie",
    );
    const failingFetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "mismatch" }), {
        status: 403,
      });
    }) as unknown as typeof fetch;

    const f = await createFixture({
      serverUrl: "http://127.0.0.1:3000",
      sessionCookie: sessionCookieSpy,
      fetcher: failingFetcher,
    });
    try {
      const randomPort = 49152 + Math.floor(Math.random() * 10000);
      const enabled = await f.invokeRun({
        op: "config.update",
        patch: {
          enabled: true,
          port: randomPort,
          tls: false,
          advertiseMdns: false,
        },
      });
      expect(enabled.running).toBe(true);
      const opened = await f.invokeRun({ op: "pairing.open" });
      expect(opened.pairing).toBeDefined();

      const pairRes = await fetch(
        `http://127.0.0.1:${randomPort}/companion/v1/pair`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pin: opened.pairing!.pin,
            device_name: "Phone",
            platform: "ios",
          }),
        },
      );
      expect(pairRes.status).toBe(503);
      expect(await pairRes.json()).toMatchObject({
        error: { code: "SESSION_UNAVAILABLE" },
      });
      expect(sessionCookieSpy).not.toHaveBeenCalled();
    } finally {
      await f.host.stop("quit");
    }
  });
});
