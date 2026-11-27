import { requestBodyText } from "@linger/service-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUICK_NOTE_IPC } from "../shared/quick-note.js";

const fake = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { EventEmitter } =
    require("node:events") as typeof import("node:events");
  /* eslint-enable @typescript-eslint/no-require-imports */
  interface MockEvent {
    readonly sender?: unknown;
    readonly senderFrame?: { readonly url: string } | null;
  }
  type Handler = (event: MockEvent, ...args: unknown[]) => unknown;

  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Handler>();
  let protocolHandler: ((request: Request) => Response) | undefined;
  const pages = {
    protocol: {
      handle: (_scheme: string, fn: (request: Request) => Response) => {
        protocolHandler = fn;
      },
      unhandle: () => {
        protocolHandler = undefined;
      },
    },
  };
  const theme = Object.assign(new EventEmitter(), {
    shouldUseDarkColors: false,
  });
  const windows: FakeWindow[] = [];

  class FakeWindow {
    readonly options: Record<string, unknown>;
    readonly webContents = {
      on: () => {},
      setWindowOpenHandler: () => {},
      reload: vi.fn(),
    };
    readonly events = new Map<string, () => void>();
    loadURL = vi.fn(async () => {});
    show = vi.fn();
    focus = vi.fn();
    close = vi.fn(() => this.events.get("closed")?.());
    destroy = vi.fn();
    isDestroyed = vi.fn(() => false);
    setBackgroundColor = vi.fn();
    setTitle = vi.fn();

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
    listeners,
    pages,
    theme,
    windows,
    FakeWindow,
    getProtocolHandler: () => protocolHandler,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: fake.FakeWindow,
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown,
    ) => fake.handlers.set(channel, handler),
    removeHandler: (channel: string) => fake.handlers.delete(channel),
    on: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ) => fake.listeners.set(channel, listener),
    removeListener: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ) => {
      if (fake.listeners.get(channel) === listener)
        fake.listeners.delete(channel);
    },
  },
  nativeTheme: fake.theme,
  session: { fromPartition: () => fake.pages },
}));
vi.mock("../shell/quick-note.html", () => ({
  default: '<html lang="en"><script>/* quick-note */</script></html>',
}));
vi.mock("../shell/messages.html", () => ({
  default: "<script>/* messages */</script>",
}));

import zhCN from "../i18n/locales/zh-CN.json" with { type: "json" };

const { LanguageModule } = await import("./language.js");
const { QUICK_NOTE_URL, QuickNoteModule } = await import("./quick-note.js");
const { stubModule, testHost } = await import("./test-support.js");

const SERVER = "http://localhost:3000";
const TENANT = "tenant-1";
const COOKIE = "session=abc";

const pageResponse = (text: string): Response =>
  new Response(
    JSON.stringify({
      today: "2026-11-15",
      items: text
        ? [{ date: "2026-11-15", text, updated_at: "2026-11-15T08:00:00Z" }]
        : [],
      page: { has_more: false },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const fixture = async (
  options: {
    cookie?: string | undefined;
    tenantId?: string | undefined;
    systemLanguages?: string[];
  } = {},
) => {
  const sessionCookie = vi.fn(async () =>
    "cookie" in options ? options.cookie : COOKIE,
  );
  const language = new LanguageModule({
    systemLanguages: () => options.systemLanguages ?? ["en-US"],
  });
  const module = new QuickNoteModule({
    preload: "/preload/quick-note.cjs",
    sessionCookie,
  });
  const host = testHost([stubModule("Config"), language, module], {
    serverUrl: SERVER,
    tenantId: "tenantId" in options ? options.tenantId : TENANT,
    computerId: "computer-1",
  });
  await host.start();
  module.show();
  const window = fake.windows[fake.windows.length - 1]!;
  const invoke = (text?: unknown, sender: unknown = window.webContents) =>
    fake.handlers.get(QUICK_NOTE_IPC.submit)!(
      {
        sender,
        senderFrame: { url: QUICK_NOTE_URL },
      },
      text,
    );
  return { host, language, module, sessionCookie, window, invoke };
};

const respond = (given: readonly Response[]) => {
  const responses = [...given];
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(
    async (input: unknown, init: RequestInit = {}): Promise<Response> => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
};

beforeEach(() => {
  fake.handlers.clear();
  fake.listeners.clear();
  fake.windows.length = 0;
  fake.theme.shouldUseDarkColors = false;
  fake.theme.removeAllListeners("updated");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("QuickNoteModule", () => {
  it("appends to today's Pocket Note below a blank line", async () => {
    vi.useFakeTimers();
    const { calls } = respond([
      pageResponse("Morning thoughts"),
      pageResponse(""),
    ]);
    const f = await fixture();

    const result = await f.invoke("A new idea");

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(
      `${SERVER}/v0/tenants/${TENANT}/me/pocket-notes`,
    );
    expect(calls[0]!.init.headers).toMatchObject({ cookie: COOKIE });
    expect(calls[1]!.url).toBe(
      `${SERVER}/v0/tenants/${TENANT}/me/pocket-notes/today`,
    );
    expect(calls[1]!.init.method).toBe("PUT");
    expect(JSON.parse(requestBodyText(calls[1]!.init.body))).toEqual({
      text: "Morning thoughts\n\nA new idea",
    });
    expect(f.window.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    expect(f.window.close).toHaveBeenCalledOnce();
    await f.host.stop("quit");
  });

  it("writes the note as today's page when there is none yet", async () => {
    const { calls } = respond([pageResponse(""), pageResponse("")]);
    const f = await fixture();

    expect(await f.invoke("First note")).toEqual({ ok: true });
    expect(JSON.parse(requestBodyText(calls[1]!.init.body))).toEqual({
      text: "First note",
    });
    await f.host.stop("quit");
  });

  it("keeps the window open with a plain message when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const f = await fixture();

    expect(await f.invoke("A new idea")).toEqual({
      ok: false,
      message: "Couldn't save the note. Try again.",
    });
    expect(f.window.close).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("reports a failed Pocket Note read without writing", async () => {
    const { fetchMock } = respond([new Response(null, { status: 500 })]);
    const f = await fixture();

    expect(await f.invoke("A new idea")).toEqual({
      ok: false,
      message: "Couldn't read today's note. Try again.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await f.host.stop("quit");
  });

  it("asks the person to sign in when there is no session", async () => {
    const { fetchMock } = respond([]);
    const f = await fixture({ cookie: undefined });

    expect(await f.invoke("A new idea")).toEqual({
      ok: false,
      message: "Sign in to LingerX first.",
    });
    expect(f.sessionCookie).toHaveBeenCalledWith(SERVER);
    expect(fetchMock).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("asks to connect this computer when it is not enrolled", async () => {
    const { fetchMock } = respond([]);
    const f = await fixture({ tenantId: undefined });

    expect(await f.invoke("A new idea")).toEqual({
      ok: false,
      message: "Connect this computer in LingerX first.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("says the session ended when TeamHub answers 401", async () => {
    respond([new Response(null, { status: 401 })]);
    const f = await fixture();

    expect(await f.invoke("A new idea")).toEqual({
      ok: false,
      message: "Your LingerX session ended. Sign in again, then try once more.",
    });
    await f.host.stop("quit");
  });

  it("localizes the page, window title, and errors in zh-CN and follows OS dark mode", async () => {
    fake.theme.shouldUseDarkColors = true;
    const f = await fixture({
      cookie: undefined,
      systemLanguages: ["zh-CN"],
    });

    expect(f.window.options.title).toBe(zhCN.quickNote.pageTitle);
    expect(f.window.options.backgroundColor).toBe("#161614");
    expect(await f.invoke("A new idea")).toEqual({
      ok: false,
      message: zhCN.quickNote.notSignedIn,
    });

    const served = await fake.getProtocolHandler()!(
      new Request(QUICK_NOTE_URL),
    ).text();
    expect(served).toContain('<html lang="zh-CN"');
    expect(served).toContain(zhCN.quickNote.label);

    fake.theme.shouldUseDarkColors = false;
    fake.theme.emit("updated");
    expect(f.window.setBackgroundColor).toHaveBeenLastCalledWith("#ffffff");
    await f.host.stop("quit");
  });

  it("refuses a sender that is not the capture window", async () => {
    const { fetchMock } = respond([]);
    const f = await fixture();

    expect(() => f.invoke("A new idea", {})).toThrow("Not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("closes the window when the person cancels", async () => {
    const f = await fixture();

    fake.listeners.get(QUICK_NOTE_IPC.cancel)!({
      sender: f.window.webContents,
      senderFrame: { url: QUICK_NOTE_URL },
    });

    expect(f.window.close).toHaveBeenCalledOnce();
    await f.host.stop("quit");
  });

  it("cancels the delayed auto-close when reopened before 900ms", async () => {
    vi.useFakeTimers();
    respond([pageResponse("Earlier"), pageResponse("")]);
    const f = await fixture();

    expect(await f.invoke("Follow-up")).toEqual({ ok: true });
    vi.advanceTimersByTime(400);
    f.module.show();
    vi.advanceTimersByTime(600);

    expect(f.window.close).not.toHaveBeenCalled();
    expect(f.window.show).toHaveBeenCalledOnce();
    expect(f.window.focus).toHaveBeenCalledOnce();
    await f.host.stop("quit");
  });

  it("serializes concurrent submissions so notes do not overwrite each other", async () => {
    let saved = "";
    const order: string[] = [];
    let releaseFirstGet!: () => void;
    const firstGetGate = new Promise<void>((resolve) => {
      releaseFirstGet = resolve;
    });
    let getCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init: RequestInit = {}) => {
        if (!init.method || init.method === "GET") {
          getCount += 1;
          order.push(`GET#${getCount}`);
          if (getCount === 1) await firstGetGate;
          return pageResponse(saved);
        }
        const body = JSON.parse(requestBodyText(init.body)) as { text: string };
        saved = body.text;
        order.push(`PUT:${body.text}`);
        return pageResponse(saved);
      }),
    );
    const f = await fixture();

    const first = f.invoke("First");
    const second = f.invoke("Second");
    await vi.waitFor(() => expect(order).toEqual(["GET#1"]));
    releaseFirstGet();

    expect(await Promise.all([first, second])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(order).toEqual([
      "GET#1",
      "PUT:First",
      "GET#2",
      "PUT:First\n\nSecond",
    ]);
    await f.host.stop("quit");
  });
});
