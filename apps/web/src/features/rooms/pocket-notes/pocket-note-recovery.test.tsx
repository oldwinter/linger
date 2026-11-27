import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubPocketNote,
  TeamHubPocketNotePage,
} from "@/features/teamhub/teamhub-types";
import { defineGlobalProperty } from "@/test/global-properties";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import {
  localPocketNoteDate,
  readPocketNoteDraft,
  writePocketNoteDraft,
} from "./pocket-note-draft";
import PocketNotePanel from "./pocket-note-panel";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function pasteText(editor: HTMLElement, text: string) {
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
}

function page(today: string, note?: TeamHubPocketNote): TeamHubPocketNotePage {
  return {
    items: note && note.text ? [note] : [],
    page: { has_more: false },
    today,
  };
}

describe("PocketNotePanel local draft recovery and isolation", () => {
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    Object.defineProperties(Range.prototype, {
      getClientRects: { configurable: true, value: () => [] },
      getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
    });
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    vi.restoreAllMocks();
  });

  function renderPanel(options: {
    accountId: string;
    listPocketNotes: () => unknown;
    putTodayPocketNote?: (body: {
      expected_updated_at?: string;
      text: string;
    }) => unknown;
    tenantId?: string;
  }) {
    const tenantId = options.tenantId ?? "tenant-1";
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () =>
      options.listPocketNotes(),
    );
    if (options.putTodayPocketNote) {
      runtime.server.on(
        "PUT",
        "/v0/tenants/{tenantId}/me/pocket-notes/today",
        ({ body }) =>
          options.putTodayPocketNote!(
            body as { expected_updated_at?: string; text: string },
          ),
      );
    }
    const anchor = document.createElement("button");
    const closeRef: RefObject<(() => void) | undefined> = {
      current: undefined,
    };
    const onClose = vi.fn();
    const view = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <PocketNotePanel
            accountId={options.accountId}
            anchor={anchor}
            closeRef={closeRef}
            onClose={onClose}
            tenantId={tenantId}
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    return { onClose, runtime, view };
  }

  it("persists an offline edit across reload, marks it unsynced, and clears recovery storage once confirmed", async () => {
    const today = "2026-10-01";
    const scope = {
      accountId: "account-alice",
      date: today,
      tenantId: "tenant-1",
    };
    let offline = true;
    let serverNote: TeamHubPocketNote | undefined;
    const put = vi.fn(
      (body: { expected_updated_at?: string; text: string }) => {
        if (offline) {
          return teamHubErrorResponse(503, "POCKET_NOTE_UNAVAILABLE");
        }
        serverNote = {
          date: today,
          text: body.text,
          updated_at: "2026-10-01T11:00:00Z",
        };
        return serverNote;
      },
    );

    const first = renderPanel({
      accountId: scope.accountId,
      listPocketNotes: () => page(today, serverNote),
      putTodayPocketNote: put,
    });
    const editor = await screen.findByRole("textbox", { name: "Today’s note" });

    vi.useFakeTimers();
    pasteText(editor, "Offline note survives reload");
    await act(() => vi.advanceTimersByTimeAsync(801));
    vi.useRealTimers();

    await screen.findByText(/Couldn’t save/);
    expect(readPocketNoteDraft(scope)?.text).toBe(
      "Offline note survives reload",
    );

    // Simulate a full browser reload by unmounting and remounting with a fresh QueryClient.
    first.view.unmount();

    renderPanel({
      accountId: scope.accountId,
      listPocketNotes: () => page(today, serverNote),
      putTodayPocketNote: put,
    });
    const restoredEditor = await screen.findByRole("textbox", {
      name: "Today’s note",
    });
    expect(restoredEditor).toHaveTextContent("Offline note survives reload");
    expect(screen.getAllByText("Unsynced local draft").length).toBeGreaterThan(
      0,
    );
    expect(put).toHaveBeenCalledTimes(1);

    // Server comes back online and confirms the save.
    offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith({
      expected_updated_at: "",
      text: "Offline note survives reload",
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Unsynced local draft")).not.toBeInTheDocument();
    expect(readPocketNoteDraft(scope)).toBeUndefined();
  });

  it("recovers an unsynced draft even when GET /pocket-notes fails on offline reload", async () => {
    const today = localPocketNoteDate();
    const scope = {
      accountId: "account-alice",
      date: today,
      tenantId: "tenant-1",
    };
    writePocketNoteDraft(scope, {
      baseText: "",
      baseUpdatedAt: "",
      text: "Written before losing network",
      updatedAt: `${today}T08:00:00Z`,
    });

    let serverOnline = false;
    let savedText = "";
    renderPanel({
      accountId: scope.accountId,
      listPocketNotes: () =>
        serverOnline
          ? page(today)
          : teamHubErrorResponse(503, "POCKET_NOTES_UNAVAILABLE"),
      putTodayPocketNote: (body) => {
        savedText = body.text;
        return {
          date: today,
          text: body.text,
          updated_at: `${today}T09:00:00Z`,
        };
      },
    });

    const editor = await screen.findByRole("textbox", { name: "Today’s note" });
    expect(editor).toHaveTextContent("Written before losing network");
    expect(screen.getAllByText("Unsynced local draft").length).toBeGreaterThan(
      0,
    );

    serverOnline = true;
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));

    await waitFor(() =>
      expect(savedText).toBe("Written before losing network"),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(readPocketNoteDraft(scope)).toBeUndefined();
  });

  it("isolates local drafts across accounts, tenants, and dates", async () => {
    const aliceScope = {
      accountId: "account-alice",
      date: "2026-10-01",
      tenantId: "tenant-1",
    };
    writePocketNoteDraft(aliceScope, {
      baseText: "",
      baseUpdatedAt: "",
      text: "Alice private offline draft",
      updatedAt: "2026-10-01T08:00:00Z",
    });

    // Account B in the same tenant and date never sees Account A's draft.
    const bobView = renderPanel({
      accountId: "account-bob",
      listPocketNotes: () => page("2026-10-01"),
      tenantId: "tenant-1",
    });
    const bobEditor = await screen.findByRole("textbox", {
      name: "Today’s note",
    });
    expect(bobEditor).toHaveTextContent("");
    expect(screen.queryByText("Unsynced local draft")).not.toBeInTheDocument();
    bobView.view.unmount();

    // Account A in a different tenant never sees tenant-1's draft.
    const tenant2View = renderPanel({
      accountId: "account-alice",
      listPocketNotes: () => page("2026-10-01"),
      tenantId: "tenant-2",
    });
    const tenant2Editor = await screen.findByRole("textbox", {
      name: "Today’s note",
    });
    expect(tenant2Editor).toHaveTextContent("");
    tenant2View.view.unmount();

    // Account A on the next calendar day never sees Day 1's draft.
    const day2View = renderPanel({
      accountId: "account-alice",
      listPocketNotes: () => page("2026-10-02"),
      tenantId: "tenant-1",
    });
    const day2Editor = await screen.findByRole("textbox", {
      name: "Today’s note",
    });
    expect(day2Editor).toHaveTextContent("");
    day2View.view.unmount();

    // Account A's original draft remains safely isolated for Account A on Day 1.
    expect(readPocketNoteDraft(aliceScope)?.text).toBe(
      "Alice private offline draft",
    );
  });

  it("requires explicit confirmation to discard a local draft and removes the recovery copy", async () => {
    const today = "2026-10-01";
    const scope = {
      accountId: "account-alice",
      date: today,
      tenantId: "tenant-1",
    };
    const serverNote: TeamHubPocketNote = {
      date: today,
      text: "Server baseline",
      updated_at: "2026-10-01T09:00:00Z",
    };
    writePocketNoteDraft(scope, {
      baseText: serverNote.text,
      baseUpdatedAt: serverNote.updated_at,
      text: "Unsynced experiment",
      updatedAt: "2026-10-01T09:10:00Z",
    });

    const first = renderPanel({
      accountId: scope.accountId,
      listPocketNotes: () => page(today, serverNote),
    });

    const editor = await screen.findByRole("textbox", { name: "Today’s note" });
    expect(editor).toHaveTextContent("Unsynced experiment");

    // First click asks for confirmation without discarding yet.
    fireEvent.click(
      screen.getByRole("button", { name: "Discard local draft" }),
    );
    const confirmDialog = screen.getByRole("alertdialog", {
      name: "Discard local draft",
    });
    expect(confirmDialog).toHaveTextContent(
      "Discard your unsynced local draft and restore the server version?",
    );
    expect(editor).toHaveTextContent("Unsynced experiment");
    expect(readPocketNoteDraft(scope)?.text).toBe("Unsynced experiment");

    // Escape cancels the confirmation without closing the panel or losing the draft.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("alertdialog", { name: "Discard local draft" }),
    ).not.toBeInTheDocument();
    expect(first.onClose).not.toHaveBeenCalled();
    expect(editor).toHaveTextContent("Unsynced experiment");

    // Explicit second confirmation discards the draft and restores server text.
    fireEvent.click(
      screen.getByRole("button", { name: "Discard local draft" }),
    );
    const confirmAgain = screen.getByRole("alertdialog", {
      name: "Discard local draft",
    });
    fireEvent.click(
      within(confirmAgain).getByRole("button", { name: "Discard" }),
    );

    expect(editor).toHaveTextContent("Server baseline");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(readPocketNoteDraft(scope)).toBeUndefined();

    // Reloading after discard stays on the server baseline.
    first.view.unmount();
    renderPanel({
      accountId: scope.accountId,
      listPocketNotes: () => page(today, serverNote),
    });
    expect(
      await screen.findByRole("textbox", { name: "Today’s note" }),
    ).toHaveTextContent("Server baseline");
    expect(screen.queryByText("Unsynced local draft")).not.toBeInTheDocument();
  });

  it("keeps editing functional without crashing when localStorage throws quota or security errors", async () => {
    const throwQuota = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: throwQuota,
        getItem: throwQuota,
        key: throwQuota,
        get length() {
          return 0;
        },
        removeItem: throwQuota,
        setItem: throwQuota,
      } satisfies Storage,
    });

    const savedTexts: string[] = [];
    renderPanel({
      accountId: "account-alice",
      listPocketNotes: () => page("2026-10-01"),
      putTodayPocketNote: (body) => {
        savedTexts.push(body.text);
        return {
          date: "2026-10-01",
          text: body.text,
          updated_at: "2026-10-01T10:00:00Z",
        };
      },
    });

    const editor = await screen.findByRole("textbox", { name: "Today’s note" });
    vi.useFakeTimers();
    pasteText(editor, "Still saves without localStorage");
    await act(() => vi.advanceTimersByTimeAsync(801));
    vi.useRealTimers();

    await waitFor(() =>
      expect(savedTexts).toEqual(["Still saves without localStorage"]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
