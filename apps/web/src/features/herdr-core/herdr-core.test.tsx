import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineGlobalProperty } from "@/test/global-properties";

import {
  createHerdrCoreClient,
  HerdrCoreApiError,
  type HerdrCoreClient,
} from "./api";
import { HerdrCoreCockpitCard } from "./herdr-core-cockpit-card";
import { HerdrCoreWorkbench } from "./herdr-core-workbench";
import { LazyXtermView } from "./lazy-xterm-view";
import {
  buildHerdrAppAdoption,
  buildTerminalTree,
  filterTerminals,
  flattenTerminalTree,
  groupTerminalsBySpace,
  isMachineConnected,
  isMachineNeedsLogin,
  parseHerdrAppDoc,
  terminalStatusWord,
} from "./tree";
import type {
  HerdrCoreMachine,
  HerdrCoreStatusResponse,
  HerdrCoreTerminal,
} from "./types";

const xtermWrites = vi.hoisted(() => [] as (Uint8Array | string)[]);
const xtermResizes = vi.hoisted(
  () => [] as { readonly cols: number; readonly rows: number }[],
);
const xtermThemes = vi.hoisted(() => [] as unknown[]);
let xtermOnDataCb: ((data: string) => void) | null = null;

vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    cols: number;
    rows: number;
    readonly options: { theme?: unknown };
    constructor(opts: { cols?: number; rows?: number; theme?: unknown } = {}) {
      this.cols = opts.cols ?? 80;
      this.rows = opts.rows ?? 24;
      let currentTheme = opts.theme;
      if (currentTheme !== undefined) {
        xtermThemes.push(currentTheme);
      }
      this.options = {
        get theme() {
          return currentTheme;
        },
        set theme(next: unknown) {
          currentTheme = next;
          xtermThemes.push(next);
        },
      };
    }
    open() {}
    write(data: Uint8Array | string) {
      xtermWrites.push(data);
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
      xtermResizes.push({ cols, rows });
    }
    focus() {}
    loadAddon() {}
    onData(cb: (data: string) => void) {
      xtermOnDataCb = cb;
      return {
        dispose: () => {
          if (xtermOnDataCb === cb) xtermOnDataCb = null;
        },
      };
    }
    dispose() {}
  }
  return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  };
}

function sampleTerminal(
  overrides: Partial<HerdrCoreTerminal> & { readonly address: string },
): HerdrCoreTerminal {
  return {
    name: overrides.address,
    state: "live",
    cwd: "/workspace/linger",
    argv: ["claude"],
    labels: {},
    cols: 120,
    rows: 36,
    created_ms: 1_000,
    ...overrides,
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  binaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: (string | Uint8Array)[] = [];
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener);
    this.#listeners.set(type, set);
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  emitMessage(data: unknown) {
    this.emit("message", { data });
  }

  emit(type: string, event: unknown) {
    for (const cb of this.#listeners.get(type) ?? []) {
      cb(event);
    }
  }
}

afterEach(() => {
  cleanup();
  xtermWrites.length = 0;
  xtermResizes.length = 0;
  xtermThemes.length = 0;
  xtermOnDataCb = null;
  FakeWebSocket.instances = [];
  delete document.documentElement.dataset.theme;
  delete (window as { lingerDesktop?: unknown }).lingerDesktop;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("herdr-core API client", () => {
  it("targets canonical Track 2 endpoints in relay mode and degrades cleanly on 404/501/network errors", async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/status")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/terminal/send")) {
        return new Response(
          JSON.stringify({
            error: { code: "BLOCKED", message: "Terminal is blocked" },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      throw new TypeError("network down");
    });

    const client = createHerdrCoreClient({
      computerId: "comp-1",
      baseOrigin: "https://linger.example.com",
      fetchImpl: fetchMock,
    });
    expect(client.transportMode).toBe("teamhub_relay");

    await expect(client.getStatus()).rejects.toMatchObject({
      name: "HerdrCoreApiError",
      kind: "not_implemented",
      status: 404,
    });
    expect(calls[0]!.url).toBe(
      "https://linger.example.com/api/v1/computers/comp-1/herdr-core/status",
    );

    await expect(
      client.sendPrompt({ address: "t1", text: "go" }),
    ).rejects.toMatchObject({
      kind: "blocked",
      status: 409,
    });

    await expect(client.listMachines()).rejects.toMatchObject({
      kind: "offline",
    });

    const wsUrl = client.buildAttachWsUrl({
      address: "vps/t2",
      cols: 100,
      rows: 32,
      observe: true,
      history: 200,
      resumed: true,
    });
    expect(wsUrl).toBe(
      "wss://linger.example.com/api/v1/computers/comp-1/herdr-core/attach?address=vps%2Ft2&cols=100&rows=32&observe=true&history=200&resumed=true",
    );
  });

  it("uses Desktop direct loopback bridge with bearer token when available", async () => {
    const fetchMock: typeof fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ templates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = createHerdrCoreClient({
      computerId: "comp-local",
      directBridge: {
        running: true,
        baseUrl: "http://127.0.0.1:49123/herdr-core",
        wsBaseUrl: "ws://127.0.0.1:49123/herdr-core",
        token: "secret-bridge-token",
        detection: {
          installed: true,
          running: true,
          binaryPath: "/usr/local/bin/hc",
          socketPath: "/tmp/default.sock",
          session: "default",
          platform: "darwin",
          sharedCore: true,
          version: "0.1.21",
          installHint: "",
        },
      },
      fetchImpl: fetchMock,
    });

    expect(client.transportMode).toBe("desktop_direct");
    await client.listTemplates();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:49123/herdr-core/templates",
      expect.objectContaining({
        credentials: "omit",
        headers: expect.objectContaining({
          authorization: "Bearer secret-bridge-token",
        }),
      }),
    );

    const wsUrl = client.buildAttachWsUrl({
      address: "t1",
      cols: 80,
      rows: 24,
      observe: true,
    });
    expect(wsUrl).toContain("ws://127.0.0.1:49123/herdr-core/attach?");
    expect(wsUrl).toContain("token=secret-bridge-token");
  });
});

describe("herdr-core tree, filtering, and herdr-app doc sync helpers", () => {
  it("pins blocked trees at the top and preserves parent-child nesting safely", () => {
    const terminals: HerdrCoreTerminal[] = [
      sampleTerminal({
        address: "t1",
        name: "idle-shell",
        status: { status: "idle" },
        created_ms: 3000,
      }),
      sampleTerminal({
        address: "t2",
        name: "lead",
        status: { state: "working", msg: "Orchestrating", progress: 60 },
        created_ms: 2000,
      }),
      sampleTerminal({
        address: "t3",
        name: "helper",
        parent: "t2",
        status: { state: "blocked", msg: "Need permission" },
        created_ms: 2500,
      }),
    ];

    const tree = buildTerminalTree(terminals);
    const flat = flattenTerminalTree(tree);
    // Parent tree containing blocked child t3 pins ahead of idle t1.
    expect(flat.map((n) => [n.terminal.address, n.depth])).toEqual([
      ["t2", 0],
      ["t3", 1],
      ["t1", 0],
    ]);
    expect(tree[0]!.descendantCount).toBe(1);
    expect(terminalStatusWord(terminals[0]!)).toBe("idle");
    expect(terminalStatusWord(terminals[2]!)).toBe("blocked");
    expect(isMachineConnected({ name: "vps", state: "connected" })).toBe(true);
    expect(isMachineConnected({ name: "vps", state: "unreachable" })).toBe(
      false,
    );
    expect(isMachineNeedsLogin({ name: "vps", state: "needs_login" })).toBe(
      true,
    );
    expect(isMachineConnected({ name: "vps", online: true })).toBe(true);
    expect(isMachineConnected({ name: "vps", online: false })).toBe(false);
    expect(isMachineNeedsLogin({ name: "vps", status: "needs_login" })).toBe(
      true,
    );
  });

  it("filters by machine, Room, Work Item, and groups/adopts terminals into herdr-app Spaces", () => {
    const terminals: HerdrCoreTerminal[] = [
      sampleTerminal({
        address: "t1",
        name: "reviewer",
        labels: {
          "linger.room": "room-alpha",
          "linger.work_item": "wi-42",
          "herdr.space": "sp-core",
        },
      }),
      sampleTerminal({
        address: "vps/t2",
        name: "remote-build",
        labels: { "linger.room": "room-beta" },
      }),
    ];

    expect(
      filterTerminals(terminals, {
        machine: "vps",
        roomOnly: false,
        workItemId: "",
        status: "all",
        search: "",
        showFinished: false,
      }).map((t) => t.address),
    ).toEqual(["vps/t2"]);

    expect(
      filterTerminals(terminals, {
        machine: "all",
        roomId: "room-alpha",
        roomOnly: true,
        workItemId: "wi-42",
        status: "all",
        search: "",
        showFinished: false,
      }).map((t) => t.address),
    ).toEqual(["t1"]);

    const parsed = parseHerdrAppDoc({
      spaces: [{ id: "sp-core", name: "Core Work", tabs: [] }],
    });
    const groups = groupTerminalsBySpace(terminals, parsed);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.spaceName).toBe("Core Work");
    expect(groups[1]!.spaceName).toBeNull();

    const adopted = buildHerdrAppAdoption({
      doc: parsed,
      terminal: terminals[1]!,
      spaceName: "Core Work",
    });
    expect(adopted.labels["herdr.space"]).toBe("sp-core");
    expect(adopted.labels["herdr.tab"]).toBe("tab-vps-t2");
    const updatedSpaces = adopted.nextDocValue.spaces as {
      readonly id: string;
      readonly tabs: readonly { readonly terminal?: string }[];
    }[];
    expect(updatedSpaces[0]!.tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ terminal: "vps/t2" })]),
    );
  });
});

describe("HerdrCoreWorkbench UI", () => {
  function createMockClient(overrides: Partial<HerdrCoreClient> = {}) {
    const status: HerdrCoreStatusResponse = {
      available: true,
      version: "0.1.21",
      core_id: "core-1",
      core_name: "mac-studio",
      pid: 1234,
      uptime_ms: 42_000,
      live_count: 2,
      finished_count: 0,
      blocked_count: 1,
      working_count: 1,
      machines: [{ name: "vps", host: "vps.dev", connected: true }],
    };
    const machines: HerdrCoreMachine[] = [
      { name: "vps", host: "vps.dev", connected: true },
    ];
    const terminals: HerdrCoreTerminal[] = [
      sampleTerminal({
        address: "t1",
        name: "reviewer",
        template: "reviewer",
        turn: 4,
        labels: { "linger.room": "room-1", "herdr.space": "sp-main" },
        status: {
          status: "blocked",
          kind: "permission",
          msg: "Approve shell command?",
        },
      }),
      sampleTerminal({
        address: "vps/t2",
        name: "builder",
        parent: "t1",
        labels: { "linger.room": "room-1" },
        status: { status: "working", msg: "Running tests", progress: 55 },
      }),
    ];

    const client: HerdrCoreClient = {
      computerId: "comp-1",
      transportMode: "teamhub_relay",
      directBridge: null,
      getStatus: vi.fn(async () => status),
      listTerminals: vi.fn(async () => ({ terminals, machines })),
      getTerminal: vi.fn(async (address) => ({
        terminal: terminals.find((t) => t.address === address) ?? terminals[0]!,
      })),
      readTerminal: vi.fn(async (address) => ({
        text: `Output for ${address}\nAllow tool? [y/n]`,
        complete: false,
        how: "screen",
        why: "blocked",
      })),
      launchTerminal: vi.fn(async () => ({
        terminal: sampleTerminal({ address: "t9", name: "fresh" }),
      })),
      sendPrompt: vi.fn(async () => ({ started: true, turn: 2 })),
      sendKeys: vi.fn(async () => ({ turn: 2 })),
      interruptTerminal: vi.fn(async () => ({
        outcome: "stopped",
        key: "esc",
      })),
      killTerminal: vi.fn(async () => ({ killed: true })),
      removeTerminal: vi.fn(async () => undefined),
      labelTerminal: vi.fn(async () => ({ ok: true })),
      putFile: vi.fn(async (input) => ({
        path: `/tmp/herdr/${input.name}`,
        name: input.name,
      })),
      listTemplates: vi.fn(async () => ({
        templates: [
          { name: "reviewer", description: "Read-only code review agent" },
        ],
      })),
      listMachines: vi.fn(async () => ({ machines })),
      getDoc: vi.fn(async () => ({
        value: { spaces: [{ id: "sp-main", name: "Main Space", tabs: [] }] },
        version: 1,
      })),
      putDoc: vi.fn(async () => ({ version: 2 })),
      buildAttachWsUrl: vi.fn(
        ({ address, observe }) =>
          `ws://127.0.0.1:49999/herdr-core/attach?address=${encodeURIComponent(address)}&observe=${String(observe)}`,
      ),
      ...overrides,
    };
    return client;
  }

  it("renders Light Mode tree, transcript, quick keys, prompt send, herdr-app sync, and Launch Dialog with focus restore", async () => {
    const client = createMockClient();
    renderWithQuery(
      <HerdrCoreWorkbench
        client={client}
        computerId="comp-1"
        roomId="room-1"
      />,
    );

    // Loads terminal tree and displays transcript for top pinned blocked terminal.
    expect(await screen.findByText(/Output for t1/)).toBeVisible();
    expect(screen.getAllByText(/Approve shell command/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("1 sub-agent")).toBeVisible();

    // Pinned blocked attention strip supports immediate 1-click approval.
    fireEvent.click(screen.getByRole("button", { name: "Yes — reviewer" }));
    await waitFor(() =>
      expect(client.sendKeys).toHaveBeenCalledWith({
        address: "t1",
        keys: ["y", "enter"],
      }),
    );

    // Quick approval key bar in Light Mode dispatches terminal.keys.
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await waitFor(() =>
      expect(client.sendKeys).toHaveBeenCalledWith({
        address: "t1",
        keys: ["enter"],
      }),
    );

    // Default blocked reply uses safe CAS turn guard (if: "blocked", turn: 4).
    const replyInput = screen.getByPlaceholderText(
      /Reply to reviewer's blocked prompt/,
    );
    fireEvent.change(replyInput, {
      target: { value: "Allow read-only command" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(client.sendPrompt).toHaveBeenCalledWith({
        address: "t1",
        text: "Allow read-only command",
        if: "blocked",
        turn: 4,
      }),
    );
    expect(screen.getByTestId("herdr-action-feedback")).toHaveTextContent(
      "Delivered to reviewer",
    );

    // Enabling Bypass turn check dispatches force: true.
    fireEvent.click(screen.getByLabelText("Bypass turn check"));
    fireEvent.change(replyInput, {
      target: { value: "Proceed carefully" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(client.sendPrompt).toHaveBeenCalledWith({
        address: "t1",
        text: "Proceed carefully",
        force: true,
      }),
    );

    // Adopt terminal into herdr-app Space updates docs/herdr-app without hitting labelTerminal in relay mode.
    fireEvent.click(screen.getByRole("button", { name: "Add to Space" }));
    const spaceInput = screen.getByPlaceholderText("Space name…");
    fireEvent.change(spaceInput, { target: { value: "Main Space" } });
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() =>
      expect(client.putDoc).toHaveBeenCalledWith(
        "herdr-app",
        expect.objectContaining({
          spaces: expect.arrayContaining([
            expect.objectContaining({ id: "sp-main" }),
          ]),
        }),
        { version: 1 },
      ),
    );
    expect(client.labelTerminal).not.toHaveBeenCalled();

    // Two-step inline Kill confirmation prevents accidental kills.
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    expect(client.killTerminal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm kill" }));
    await waitFor(() => expect(client.killTerminal).toHaveBeenCalledWith("t1"));

    // Launch Dialog opens with role="dialog", visual Template Picker Cards, and Escape restores focus.
    const launchTrigger = screen.getByRole("button", { name: "New terminal" });
    launchTrigger.focus();
    fireEvent.click(launchTrigger);

    const dialog = await screen.findByRole("dialog", {
      name: "Launch terminal",
    });
    expect(dialog).toBeVisible();
    const reviewerCard = await within(dialog).findByRole("radio", {
      name: /reviewer/i,
    });
    fireEvent.click(reviewerCard);
    fireEvent.change(within(dialog).getByLabelText("Machine"), {
      target: { value: "vps" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Launch" }));

    await waitFor(() =>
      expect(client.launchTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          template: "reviewer",
          on: "vps",
          labels: { "linger.room": "room-1" },
        }),
      ),
    );

    // Reopen dialog and press cancel event (Escape) to confirm focus returns to opener.
    launchTrigger.focus();
    fireEvent.click(launchTrigger);
    const dialog2 = await screen.findByRole("dialog", {
      name: "Launch terminal",
    });
    fireEvent(dialog2, new Event("cancel", { cancelable: true }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Launch terminal" }),
      ).not.toBeInTheDocument();
    });
    await waitFor(() => expect(launchTrigger).toHaveFocus());
  });

  it("preserves scroll position when reading history and surfaces stale-turn 409 conflicts", async () => {
    let readCall = 0;
    const client = createMockClient({
      readTerminal: vi.fn(async () => {
        readCall += 1;
        return {
          text:
            readCall === 1
              ? "Line 1\nLine 2\nLine 3"
              : "Line 1\nLine 2\nLine 3\nLine 4 (new)",
          complete: true,
          how: "screen",
        };
      }),
      sendPrompt: vi.fn(async () => {
        throw new HerdrCoreApiError({
          status: 409,
          kind: "conflict",
          message: "Turn mismatch",
        });
      }),
    });

    renderWithQuery(<HerdrCoreWorkbench client={client} computerId="comp-1" />);

    const transcript = await screen.findByTestId("herdr-transcript");
    expect(transcript).toHaveTextContent("Line 1");

    // Simulate user scrolling up to read earlier history.
    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      value: 1_000,
    });
    Object.defineProperty(transcript, "clientHeight", {
      configurable: true,
      value: 200,
    });
    transcript.scrollTop = 100;
    fireEvent.scroll(transcript);

    // Trigger manual refresh — scrollTop must NOT jump to 1000, and Jump to latest appears.
    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    fireEvent.click(refreshButtons[refreshButtons.length - 1]!);
    expect(await screen.findByText(/Line 4 \(new\)/)).toBeVisible();
    expect(transcript.scrollTop).toBe(100);
    const jumpBtn = screen.getByRole("button", { name: "Jump to latest" });
    expect(jumpBtn).toBeVisible();

    fireEvent.click(jumpBtn);
    expect(transcript.scrollTop).toBe(1_000);

    // 409 conflict surfaces a clear stale-turn notice.
    fireEvent.change(
      screen.getByPlaceholderText(/Reply to reviewer's blocked prompt/),
      { target: { value: "Too late" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(
      await screen.findByText(
        "Terminal already moved on to a new turn — nothing was typed.",
      ),
    ).toBeVisible();
  });

  it("degrades gracefully when backend returns 501 not implemented and works at 390px mobile width", async () => {
    const client = createMockClient({
      getStatus: vi.fn(async () => {
        throw new HerdrCoreApiError({
          status: 501,
          kind: "not_implemented",
          message: "Not implemented",
        });
      }),
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    renderWithQuery(<HerdrCoreWorkbench client={client} computerId="comp-1" />);
    expect(
      await screen.findByText("Terminal control plane unavailable"),
    ).toBeVisible();
  });
});

describe("LazyXtermView interactive PTY attach", () => {
  it("defaults to observe mode, blocks typing until Take Over, streams PTY bytes, reconnects with resumed=true, and handles terminal.put", async () => {
    defineGlobalProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FakeWebSocket,
    });

    const client = createHerdrCoreClient({
      computerId: "comp-1",
      baseOrigin: "http://127.0.0.1:3000",
    });
    const onStatus = vi.fn();

    const { rerender } = render(
      <LazyXtermView
        address="t1"
        client={client}
        initialCols={100}
        initialRows={30}
        onStatusMessage={onStatus}
      />,
    );

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws1 = FakeWebSocket.instances[0]!;
    expect(ws1.url).toContain("observe=true");
    expect(ws1.url).not.toContain("resumed=true");

    act(() => {
      ws1.emitOpen();
      ws1.emitMessage(
        JSON.stringify({
          type: "attached",
          observe: true,
          cols: 100,
          rows: 30,
        }),
      );
      ws1.emitMessage(new TextEncoder().encode("HELLO_PTY").buffer);
    });

    expect(screen.getByTestId("herdr-pty-mode-badge")).toHaveTextContent(
      "Observing (read-only)",
    );
    expect(xtermWrites).toHaveLength(1);
    expect(new TextDecoder().decode(xtermWrites[0] as Uint8Array)).toBe(
      "HELLO_PTY",
    );

    // Unrelated prop callback or polled dimension changes must NOT recreate the WebSocket!
    rerender(
      <LazyXtermView
        address="t1"
        client={client}
        initialCols={132}
        initialRows={42}
        onStatusMessage={vi.fn()}
      />,
    );
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Theme changes on documentElement update xterm options.theme live.
    const themesBefore = xtermThemes.length;
    document.documentElement.dataset.theme = "dark";
    await waitFor(() =>
      expect(xtermThemes.length).toBeGreaterThan(themesBefore),
    );

    // Typing while observing must NOT send binary bytes over WS.
    act(() => {
      xtermOnDataCb?.("blocked-keystroke");
    });
    expect(ws1.sent).toHaveLength(0);

    // Take Over sends { type: "mode", observe: false, cols, rows }, { type: "focus", focused: true },
    // and unlocks interactive binary input.
    fireEvent.click(screen.getByTestId("herdr-take-over-toggle"));
    expect(JSON.parse(ws1.sent[0] as string)).toMatchObject({
      type: "mode",
      observe: false,
      cols: 100,
      rows: 30,
    });
    expect(JSON.parse(ws1.sent[1] as string)).toEqual({
      type: "focus",
      focused: true,
    });
    act(() => {
      xtermOnDataCb?.("ls\n");
    });
    expect(new TextDecoder().decode(ws1.sent[2] as Uint8Array)).toBe("ls\n");

    // Drag-and-drop file uploads via WS put and surfaces put_result error or landed path.
    const file = new File(["image-bytes"], "shot.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("image-bytes").buffer,
    });
    fireEvent.drop(screen.getByTestId("herdr-xterm-view"), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() =>
      expect(
        ws1.sent.some(
          (entry) =>
            typeof entry === "string" && entry.includes('"type":"put"'),
        ),
      ).toBe(true),
    );
    act(() => {
      ws1.emitMessage(
        JSON.stringify({
          type: "put_result",
          ok: false,
          error: "Disk full",
        }),
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Disk full");

    act(() => {
      ws1.emitMessage(
        JSON.stringify({
          type: "put_result",
          ok: true,
          path: "/tmp/herdr/shot.png",
          name: "shot.png",
        }),
      );
    });
    expect(screen.getByTestId("herdr-landed-file")).toHaveTextContent(
      "File landed at /tmp/herdr/shot.png",
    );

    // Closing socket triggers automatic reconnect with resumed=true.
    vi.useFakeTimers();
    act(() => {
      ws1.close();
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.url).toContain("resumed=true");
  });

  it("falls back to REST putFile when uploading in observe mode", async () => {
    defineGlobalProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FakeWebSocket,
    });

    const fetchMock: typeof fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ path: "/tmp/herdr/spec.txt", name: "spec.txt" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const client = createHerdrCoreClient({
      computerId: "comp-1",
      baseOrigin: "http://127.0.0.1:3000",
      fetchImpl: fetchMock,
    });

    render(<LazyXtermView address="t1" client={client} />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws1 = FakeWebSocket.instances[0]!;
    act(() => {
      ws1.emitOpen();
    });

    const file = new File(["hello"], "spec.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("hello").buffer,
    });
    fireEvent.drop(screen.getByTestId("herdr-xterm-view"), {
      dataTransfer: { files: [file] },
    });

    expect(await screen.findByTestId("herdr-landed-file")).toHaveTextContent(
      "File landed at /tmp/herdr/spec.txt",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/v1/computers/comp-1/herdr-core/terminal/put",
      expect.objectContaining({ method: "POST" }),
    );
    expect(ws1.sent).toHaveLength(0);
  });
});

describe("HerdrCoreCockpitCard Magpie telemetry widget", () => {
  it("renders live/working/blocked/error tallies, online machines, and jumps to blocked agents", () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    renderWithQuery(
      <HerdrCoreCockpitCard
        computerId="comp-1"
        onOpenWorkbench={onOpen}
        onSelectTerminal={onSelect}
        status={{
          available: true,
          version: "0.1.21",
          core_id: "core-1",
          core_name: "mac",
          pid: 100,
          uptime_ms: 5000,
          live_count: 3,
          finished_count: 1,
          blocked_count: 1,
          working_count: 1,
          machines: [
            { name: "vps", connected: true },
            { name: "wsl", connected: false },
          ],
        }}
        terminals={[
          sampleTerminal({
            address: "t1",
            name: "deploy-agent",
            status: { status: "blocked", msg: "Confirm production push" },
          }),
          sampleTerminal({
            address: "t2",
            name: "test-runner",
            status: { status: "error", msg: "Unit test failed" },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("herdr-core-identity")).toHaveTextContent(
      "herdr-core 0.1.21 · mac",
    );
    expect(screen.getByText("3 live")).toBeVisible();
    expect(screen.getByText("1 working")).toBeVisible();
    expect(screen.getAllByText("1 waiting").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1 error")).toBeVisible();
    expect(screen.getByText("2/3 machines")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /deploy-agent/ }));
    expect(onSelect).toHaveBeenCalledWith("t1");

    fireEvent.click(screen.getByRole("button", { name: "Open workbench" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("supports Compact density, offline/unavailable states, and blocked-agent fallback jump", async () => {
    const onOpen = vi.fn();
    const { queryClient, rerender } = renderWithQuery(
      <HerdrCoreCockpitCard
        computerId="comp-1"
        density="compact"
        onOpenWorkbench={onOpen}
        status={{
          available: true,
          version: "0.1.21",
          core_id: "core-1",
          core_name: "mac-studio",
          pid: 100,
          uptime_ms: 5000,
          live_count: 2,
          finished_count: 1,
          blocked_count: 1,
          working_count: 1,
          machines: [],
        }}
        terminals={[]}
      />,
    );

    expect(screen.getByTestId("herdr-core-cockpit-card")).toHaveAttribute(
      "data-cockpit-density",
      "compact",
    );
    expect(screen.getByTestId("herdr-core-identity")).toHaveTextContent(
      "herdr-core 0.1.21 · mac-studio",
    );
    expect(
      document.querySelector("[data-cockpit-herdr-verbose]"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Jump to waiting/i }));
    expect(onOpen).toHaveBeenCalledOnce();

    // Unavailable state degrades gracefully.
    rerender(
      <QueryClientProvider client={queryClient}>
        <HerdrCoreCockpitCard
          computerId="comp-1"
          onOpenWorkbench={onOpen}
          status={{
            available: false,
            version: null,
            core_id: null,
            core_name: null,
            pid: null,
            uptime_ms: null,
            live_count: 0,
            finished_count: 0,
            blocked_count: 0,
            working_count: 0,
            machines: [],
          }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("herdr-core unavailable")).toBeVisible();
    expect(screen.getByTestId("herdr-core-degraded-note")).toBeVisible();

    // Offline computer state degrades without querying.
    rerender(
      <QueryClientProvider client={queryClient}>
        <HerdrCoreCockpitCard
          computerId="comp-1"
          computerOnline={false}
          onOpenWorkbench={onOpen}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("herdr-core offline")).toBeVisible();
  });
});
