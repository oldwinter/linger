import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUICK_NOTE_IPC } from "../shared/quick-note.js";

const fake = vi.hoisted(() => {
  interface MockEvent {
    readonly sender?: unknown;
    readonly senderFrame?: { readonly url: string } | null;
  }
  type Handler = (event: MockEvent, ...args: unknown[]) => unknown;

  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Handler>();
  const pages = { protocol: { handle: () => {}, unhandle: () => {} } };
  const windows: FakeWindow[] = [];

  class FakeWindow {
    readonly options: Record<string, unknown>;
    readonly webContents = {
      on: () => {},
      setWindowOpenHandler: () => {},
    };
    readonly events = new Map<string, () => void>();
    loadURL = vi.fn(async () => {});
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

  return { handlers, listeners, pages, windows, FakeWindow };
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
  session: { fromPartition: () => fake.pages },
}));
vi.mock("../shell/quick-note.html", () => ({ default: "<html></html>" }));

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
  } = {},
) => {
  const sessionCookie = vi.fn(async () =>
    "cookie" in options ? options.cookie : COOKIE,
  );
  const module = new QuickNoteModule({
    preload: "/preload/quick-note.cjs",
    sessionCookie,
  });
  const host = testHost([stubModule("Config"), module], {
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
  return { host, module, sessionCookie, window, invoke };
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
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
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
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
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
      message: "Sign in to Linger first.",
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
      message: "Connect this computer in Linger first.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("says the session ended when TeamHub answers 401", async () => {
    respond([new Response(null, { status: 401 })]);
    const f = await fixture();

    expect(await f.invoke("A new idea")).toEqual({
      ok: false,
      message: "Your Linger session ended. Sign in again, then try once more.",
    });
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
});
