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
  broadcastPocketNoteUpdated,
  readPocketNoteDraft,
  writePocketNoteDraft,
} from "./pocket-note-draft";
import PocketNotePanel from "./pocket-note-panel";
import { pocketNotesQueryKey } from "./pocket-note-queries";
import { saveMessageToPocketNote } from "./save-message-to-pocket-note";

const tenantId = "tenant-1";
const accountId = "account-alice";
const today = "2026-10-01";

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

/**
 * Shared conflict-enforcing TeamHub Pocket Note authority matching TeamHub's
 * real PUT /me/pocket-notes/today optimistic concurrency behavior.
 */
function createAuthoritativePocketNoteStore(initialText: string) {
  let version = initialText ? 1 : 0;
  let current: TeamHubPocketNote | undefined = initialText
    ? {
        date: today,
        text: initialText,
        updated_at: "2026-10-01T09:00:00.000001Z",
      }
    : undefined;

  return {
    get(): TeamHubPocketNotePage {
      return {
        items: current ? [{ ...current }] : [],
        page: { has_more: false },
        today,
      };
    },
    text(): string {
      return current?.text ?? "";
    },
    updatedAt(): string {
      return current?.updated_at ?? "";
    },
    put(body: { expected_updated_at?: string; text: string }) {
      const currentToken = current ? current.updated_at : "";
      if (
        body.expected_updated_at !== undefined &&
        body.expected_updated_at !== currentToken
      ) {
        return teamHubErrorResponse(
          409,
          "POCKET_NOTE_CONFLICT",
          "Today's Pocket Note changed on the server; refresh before saving",
        );
      }
      version += 1;
      const nextUpdatedAt = `2026-10-01T09:00:00.${String(version).padStart(6, "0")}Z`;
      if (body.text === "") {
        current = undefined;
        return { date: today, text: "", updated_at: nextUpdatedAt };
      }
      current = { date: today, text: body.text, updated_at: nextUpdatedAt };
      return { ...current };
    },
  };
}

function attachStoreToRuntime(
  store: ReturnType<typeof createAuthoritativePocketNoteStore>,
  options?: {
    beforePut?: (body: {
      expected_updated_at?: string;
      text: string;
    }) => Promise<void> | void;
  },
) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () =>
    store.get(),
  );
  runtime.server.on(
    "PUT",
    "/v0/tenants/{tenantId}/me/pocket-notes/today",
    async ({ body }) => {
      const payload = body as { expected_updated_at?: string; text: string };
      await options?.beforePut?.(payload);
      return store.put(payload);
    },
  );
  return runtime;
}

function renderTab(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const anchor = document.createElement("button");
  const closeRef: RefObject<(() => void) | undefined> = { current: undefined };
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <PocketNotePanel
          accountId={accountId}
          anchor={anchor}
          closeRef={closeRef}
          onClose={onClose}
          tenantId={tenantId}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { onClose, queryClient, view };
}

describe("Pocket Notes competing-writer conflict coordination", () => {
  const originalLocalStorage = window.localStorage;
  const originalBroadcastChannel = window.BroadcastChannel;

  beforeEach(() => {
    Object.defineProperties(Range.prototype, {
      getClientRects: { configurable: true, value: () => [] },
      getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
    });
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
    // Keep BroadcastChannel off in out-of-order PUT race tests so the conflict
    // is genuinely exercised at the shared HTTP write boundary.
    defineGlobalProperty(window, "BroadcastChannel", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    defineGlobalProperty(window, "BroadcastChannel", {
      configurable: true,
      value: originalBroadcastChannel,
    });
    vi.restoreAllMocks();
  });

  it("prevents silent clobbering when two tabs finish PUTs out of order and merges both cleanly", async () => {
    const store = createAuthoritativePocketNoteStore("Morning");
    let releaseTab1Put = () => {};
    let tab1PutStarted = () => {};
    const tab1Gate = new Promise<void>((resolve) => {
      releaseTab1Put = resolve;
    });
    const tab1PutReachedServer = new Promise<void>((resolve) => {
      tab1PutStarted = resolve;
    });
    let holdFirstPut = true;

    const tab1Runtime = attachStoreToRuntime(store, {
      beforePut: async () => {
        if (holdFirstPut) {
          holdFirstPut = false;
          tab1PutStarted();
          await tab1Gate;
        }
      },
    });
    const tab2Runtime = attachStoreToRuntime(store);

    const tab1 = renderTab(tab1Runtime);
    const tab1Editor = await screen.findByRole("textbox", {
      name: "Today’s note",
    });
    expect(tab1Editor).toHaveTextContent("Morning");

    // Tab 1 edits and starts its slow PUT against T0.
    vi.useFakeTimers();
    pasteText(tab1Editor, "\n\nTab 1 point");
    await act(() => vi.advanceTimersByTimeAsync(801));
    vi.useRealTimers();
    await tab1PutReachedServer;

    // Meanwhile Tab 2 (loaded at T0) saves first and advances the server to T1.
    await tab2Runtime.client.api.PUT(
      "/v0/tenants/{tenantId}/me/pocket-notes/today",
      {
        body: {
          expected_updated_at: "2026-10-01T09:00:00.000001Z",
          text: "Morning\n\nTab 2 point",
        },
        params: { path: { tenantId } },
      },
    );
    expect(store.text()).toBe("Morning\n\nTab 2 point");

    // Now Tab 1's older PUT completes: 409 rejects it instead of clobbering Tab 2.
    releaseTab1Put();

    const conflictAlert = await screen.findByRole("alert", {
      name: "This note was updated elsewhere.",
    });
    expect(store.text()).toBe("Morning\n\nTab 2 point");
    expect(conflictAlert).toHaveTextContent("Morning");
    expect(conflictAlert).toHaveTextContent("Tab 2 point");
    expect(
      screen.getByText("Conflict · updated elsewhere"),
    ).toBeInTheDocument();

    // Closing while conflicted does not blindly overwrite the server.
    fireEvent.click(screen.getByRole("button", { name: "Close notes" }));
    expect(tab1.onClose).not.toHaveBeenCalled();
    expect(store.text()).toBe("Morning\n\nTab 2 point");

    // Choosing "Merge both" preserves both tabs' words without duplicating "Morning".
    fireEvent.click(
      within(conflictAlert).getByRole("button", { name: "Merge both" }),
    );

    await waitFor(() =>
      expect(store.text()).toBe("Morning\n\nTab 2 point\n\nTab 1 point"),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(
      screen.queryByRole("alert", { name: "This note was updated elsewhere." }),
    ).not.toBeInTheDocument();
    expect(
      readPocketNoteDraft({ accountId, date: today, tenantId }),
    ).toBeUndefined();
  });

  it("supports Keep my draft and Use server version resolution choices on 409 conflicts", async () => {
    const store = createAuthoritativePocketNoteStore("Base");
    const runtime = attachStoreToRuntime(store);

    // Seed a local draft whose base is stale compared to the current server state.
    const oldUpdatedAt = store.updatedAt();
    store.put({ expected_updated_at: oldUpdatedAt, text: "Server rewrite" });
    writePocketNoteDraft(
      { accountId, date: today, tenantId },
      {
        baseText: "Base",
        baseUpdatedAt: oldUpdatedAt,
        text: "My local draft",
        updatedAt: "2026-10-01T09:05:00Z",
      },
    );

    const first = renderTab(runtime);
    const conflictAlert = await screen.findByRole("alert", {
      name: "This note was updated elsewhere.",
    });
    expect(conflictAlert).toHaveTextContent("Server rewrite");

    // 1. "Use server version" discards the local draft cleanly and removes recovery storage.
    fireEvent.click(
      within(conflictAlert).getByRole("button", { name: "Use server version" }),
    );
    expect(
      await screen.findByRole("textbox", { name: "Today’s note" }),
    ).toHaveTextContent("Server rewrite");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(
      readPocketNoteDraft({ accountId, date: today, tenantId }),
    ).toBeUndefined();
    first.view.unmount();

    // 2. "Keep my draft" explicitly overwrites using the fresh server token.
    const secondBase = store.updatedAt();
    store.put({
      expected_updated_at: secondBase,
      text: "Another server edit",
    });
    writePocketNoteDraft(
      { accountId, date: today, tenantId },
      {
        baseText: "Server rewrite",
        baseUpdatedAt: secondBase,
        text: "Explicit local winner",
        updatedAt: "2026-10-01T09:06:00Z",
      },
    );

    renderTab(runtime);
    const secondAlert = await screen.findByRole("alert", {
      name: "This note was updated elsewhere.",
    });
    fireEvent.click(
      within(secondAlert).getByRole("button", { name: "Keep my draft" }),
    );

    await waitFor(() => expect(store.text()).toBe("Explicit local winner"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(
      readPocketNoteDraft({ accountId, date: today, tenantId }),
    ).toBeUndefined();
  });

  it("retries saveMessageToPocketNote on 409 so a concurrent editor save is never wiped", async () => {
    const store = createAuthoritativePocketNoteStore("Morning");
    let holdFirstMessagePut = true;
    let messagePutArrived = () => {};
    let releaseMessagePut = () => {};
    const messagePutStarted = new Promise<void>((resolve) => {
      messagePutArrived = resolve;
    });
    const messagePutGate = new Promise<void>((resolve) => {
      releaseMessagePut = resolve;
    });

    const runtime = attachStoreToRuntime(store, {
      beforePut: async (body) => {
        if (holdFirstMessagePut && body.text.includes("Important message")) {
          holdFirstMessagePut = false;
          messagePutArrived();
          await messagePutGate;
        }
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(pocketNotesQueryKey(tenantId), {
      pageParams: [undefined],
      pages: [store.get()],
    });

    // Message-to-Pocket starts with cached T0, then pauses before hitting server.
    const savePromise = saveMessageToPocketNote({
      accountId,
      authorName: "Alice",
      client: runtime.client,
      createdAt: "2026-10-01T09:15:00Z",
      message: { id: "msg-1", raw_message: "Important message" },
      queryClient,
      tenantId,
    });
    await messagePutStarted;

    // While message save is in flight, the editor finishes its own PUT at T0 -> T1.
    store.put({
      expected_updated_at: "2026-10-01T09:00:00.000001Z",
      text: "Morning\n\nEditor concurrent line",
    });

    // Release message save: first PUT gets 409, refetches T1, re-appends quote, succeeds at T2.
    releaseMessagePut();
    const saved = await savePromise;

    expect(saved.text).toContain("Morning\n\nEditor concurrent line");
    expect(saved.text).toContain("> Important message");
    expect(store.text()).toBe(saved.text);
  });

  it("protects a message saved to Pocket when the editor has an in-flight PUT that finishes later", async () => {
    const store = createAuthoritativePocketNoteStore("Morning");
    let holdEditorPut = true;
    let editorPutArrived = () => {};
    let releaseEditorPut = () => {};
    const editorPutStarted = new Promise<void>((resolve) => {
      editorPutArrived = resolve;
    });
    const editorPutGate = new Promise<void>((resolve) => {
      releaseEditorPut = resolve;
    });

    const runtime = attachStoreToRuntime(store, {
      beforePut: async (body) => {
        if (holdEditorPut && body.text.includes("In-flight editor edit")) {
          holdEditorPut = false;
          editorPutArrived();
          await editorPutGate;
        }
      },
    });

    const { queryClient } = renderTab(runtime);
    const editor = await screen.findByRole("textbox", { name: "Today’s note" });

    // Start the editor's PUT and hold it in flight.
    vi.useFakeTimers();
    pasteText(editor, "\n\nIn-flight editor edit");
    await act(() => vi.advanceTimersByTimeAsync(801));
    vi.useRealTimers();
    await editorPutStarted;

    // While the editor PUT is in flight, save a Room message to Pocket Note.
    await saveMessageToPocketNote({
      accountId,
      authorName: "Alice",
      client: runtime.client,
      createdAt: "2026-10-01T09:15:00Z",
      message: { id: "msg-2", raw_message: "Saved from Room chat" },
      queryClient,
      tenantId,
    });
    expect(store.text()).toContain("Saved from Room chat");

    // Release the editor's stale PUT -> rejected with 409 -> Room message is preserved!
    releaseEditorPut();

    const conflictAlert = await screen.findByRole("alert", {
      name: "This note was updated elsewhere.",
    });
    expect(store.text()).toContain("Saved from Room chat");
    expect(conflictAlert).toHaveTextContent("Saved from Room chat");

    // Merge both keeps both the saved Room message and the editor's edit.
    fireEvent.click(
      within(conflictAlert).getByRole("button", { name: "Merge both" }),
    );
    await waitFor(() => {
      expect(store.text()).toContain("Saved from Room chat");
      expect(store.text()).toContain("In-flight editor edit");
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("updates an open tab immediately on cross-tab sync and flags conflicting edits", async () => {
    const channels = new Set<FakeBroadcastChannel>();
    class FakeBroadcastChannel {
      readonly name: string;
      private readonly listeners = new Set<(event: MessageEvent) => void>();

      constructor(name: string) {
        this.name = name;
        channels.add(this);
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === "message") this.listeners.add(listener);
      }

      postMessage(data: unknown) {
        for (const peer of channels) {
          if (peer === this || peer.name !== this.name) continue;
          const event = new MessageEvent("message", { data });
          for (const listener of peer.listeners) listener(event);
        }
      }

      close() {
        channels.delete(this);
        this.listeners.clear();
      }
    }
    defineGlobalProperty(window, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });

    const store = createAuthoritativePocketNoteStore("Start");
    const runtime = attachStoreToRuntime(store);
    renderTab(runtime);
    const editor = await screen.findByRole("textbox", { name: "Today’s note" });
    expect(editor).toHaveTextContent("Start");

    // Simulate another tab posting a confirmed update on the shared BroadcastChannel.
    const peerChannel = new FakeBroadcastChannel("linger.pocket-notes:v1");
    act(() => {
      peerChannel.postMessage({
        accountId,
        note: {
          date: today,
          text: "Updated in Tab 2",
          updated_at: "2026-10-01T09:01:00Z",
        },
        senderId: "other-tab",
        tenantId,
      });
    });

    await waitFor(() => expect(editor).toHaveTextContent("Updated in Tab 2"));

    // Now type an unsaved edit locally, then receive a divergent edit from Tab 2.
    pasteText(editor, " + local change");
    act(() => {
      peerChannel.postMessage({
        accountId,
        note: {
          date: today,
          text: "Tab 2 replaced everything",
          updated_at: "2026-10-01T09:02:00Z",
        },
        senderId: "other-tab",
        tenantId,
      });
    });

    const conflictAlert = await screen.findByRole("alert", {
      name: "This note was updated elsewhere.",
    });
    expect(conflictAlert).toHaveTextContent("Tab 2 replaced everything");

    // Broadcast helper also stays safe when called directly.
    expect(() =>
      broadcastPocketNoteUpdated({
        accountId,
        note: {
          date: today,
          text: "Broadcast ok",
          updated_at: "2026-10-01T09:03:00Z",
        },
        tenantId,
      }),
    ).not.toThrow();
    peerChannel.close();
  });
});
