// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { defineGlobalProperty } from "@/test/global-properties";

import {
  isPocketNoteConflictError,
  mergePocketNoteConflict,
  POCKET_NOTE_CONFLICT_CODE,
} from "./pocket-note-conflict";
import {
  broadcastPocketNoteUpdated,
  clearPocketNoteDraft,
  pocketNoteDraftKey,
  pocketNoteExpectedUpdatedAt,
  readPocketNoteDraft,
  subscribePocketNoteUpdates,
  writePocketNoteDraft,
} from "./pocket-note-draft";

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

describe("pocket-note-draft storage and isolation", () => {
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  afterEach(() => {
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    vi.restoreAllMocks();
  });

  it("isolates drafts strictly by accountId, tenantId, and date", () => {
    const aliceDay1 = {
      accountId: "account-alice",
      date: "2026-10-01",
      tenantId: "tenant-1",
    };
    const bobDay1 = {
      accountId: "account-bob",
      date: "2026-10-01",
      tenantId: "tenant-1",
    };
    const aliceTenant2 = {
      accountId: "account-alice",
      date: "2026-10-01",
      tenantId: "tenant-2",
    };
    const aliceDay2 = {
      accountId: "account-alice",
      date: "2026-10-02",
      tenantId: "tenant-1",
    };

    expect(
      writePocketNoteDraft(aliceDay1, {
        baseText: "Server",
        baseUpdatedAt: "2026-10-01T09:00:00Z",
        text: "Alice secret draft",
        updatedAt: "2026-10-01T09:05:00Z",
      }),
    ).toBe(true);

    expect(readPocketNoteDraft(aliceDay1)?.text).toBe("Alice secret draft");
    expect(readPocketNoteDraft(bobDay1)).toBeUndefined();
    expect(readPocketNoteDraft(aliceTenant2)).toBeUndefined();
    expect(readPocketNoteDraft(aliceDay2)).toBeUndefined();

    clearPocketNoteDraft(bobDay1);
    expect(readPocketNoteDraft(aliceDay1)?.text).toBe("Alice secret draft");

    clearPocketNoteDraft(aliceDay1);
    expect(readPocketNoteDraft(aliceDay1)).toBeUndefined();
  });

  it("refuses incomplete scopes and ignores corrupt JSON safely", () => {
    expect(
      writePocketNoteDraft(
        { accountId: "", date: "2026-10-01", tenantId: "tenant-1" },
        {
          baseText: "",
          baseUpdatedAt: "",
          text: "No account",
          updatedAt: "2026-10-01T09:00:00Z",
        },
      ),
    ).toBe(false);
    expect(window.localStorage.length).toBe(0);

    const scope = {
      accountId: "account-alice",
      date: "2026-10-01",
      tenantId: "tenant-1",
    };
    window.localStorage.setItem(pocketNoteDraftKey(scope), "{not-valid-json");
    expect(readPocketNoteDraft(scope)).toBeUndefined();
  });

  it("prunes only strictly older dates for the same account+tenant on quota errors", () => {
    const store = new Map<string, string>();
    const aliceOld = {
      accountId: "account-alice",
      date: "2026-09-30",
      tenantId: "tenant-1",
    };
    const bobOld = {
      accountId: "account-bob",
      date: "2026-09-30",
      tenantId: "tenant-1",
    };
    const aliceToday = {
      accountId: "account-alice",
      date: "2026-10-01",
      tenantId: "tenant-1",
    };
    store.set(pocketNoteDraftKey(aliceOld), "old-alice");
    store.set(pocketNoteDraftKey(bobOld), "old-bob");

    let failOnce = true;
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: {
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
          if (failOnce) {
            failOnce = false;
            throw new DOMException("Quota exceeded", "QuotaExceededError");
          }
          store.set(key, value);
        },
      } satisfies Storage,
    });

    expect(
      writePocketNoteDraft(aliceToday, {
        baseText: "",
        baseUpdatedAt: "",
        text: "Today's draft",
        updatedAt: "2026-10-01T10:00:00Z",
      }),
    ).toBe(true);

    expect(store.has(pocketNoteDraftKey(aliceOld))).toBe(false);
    expect(store.has(pocketNoteDraftKey(bobOld))).toBe(true);
    expect(readPocketNoteDraft(aliceToday)?.text).toBe("Today's draft");
  });

  it("degrades gracefully when localStorage throws on every call", () => {
    const throwSecurity = (): never => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: throwSecurity,
        getItem: throwSecurity,
        key: throwSecurity,
        get length(): number {
          return throwSecurity();
        },
        removeItem: throwSecurity,
        setItem: throwSecurity,
      } satisfies Storage,
    });

    const scope = {
      accountId: "account-alice",
      date: "2026-10-01",
      tenantId: "tenant-1",
    };
    expect(readPocketNoteDraft(scope)).toBeUndefined();
    expect(
      writePocketNoteDraft(scope, {
        baseText: "",
        baseUpdatedAt: "",
        text: "In-memory only",
        updatedAt: "2026-10-01T10:00:00Z",
      }),
    ).toBe(false);
    expect(() => clearPocketNoteDraft(scope)).not.toThrow();
  });

  it("leaves no note text in localStorage after cross-tab broadcast and filters storage events by scope", () => {
    const scope = {
      accountId: "account-alice",
      date: "2026-10-01",
      tenantId: "tenant-1",
    };
    const onNote = vi.fn();
    const onRemoteChange = vi.fn();
    const unsubscribe = subscribePocketNoteUpdates(scope, {
      onNote,
      onRemoteChange,
    });

    broadcastPocketNoteUpdated({
      accountId: scope.accountId,
      note: {
        date: scope.date,
        text: "Confidential body",
        updated_at: "2026-10-01T10:00:00Z",
      },
      tenantId: scope.tenantId,
    });

    // No note text or lingering sync key remains in localStorage.
    expect(window.localStorage.length).toBe(0);

    // Another account's storage event is ignored.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "linger.pocket-note-sync:v1:account-bob:tenant-1:2026-10-01",
        newValue: JSON.stringify({ updatedAt: "2026-10-01T10:01:00Z" }),
      }),
    );
    expect(onRemoteChange).not.toHaveBeenCalled();

    // Matching account+tenant+date storage event triggers refetch callback.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "linger.pocket-note-sync:v1:account-alice:tenant-1:2026-10-01",
        newValue: JSON.stringify({ updatedAt: "2026-10-01T10:01:00Z" }),
      }),
    );
    expect(onRemoteChange).toHaveBeenCalledOnce();
    unsubscribe();
  });
});

describe("pocket-note-conflict helpers", () => {
  it("computes expected_updated_at consistently for empty and stored pages", () => {
    expect(pocketNoteExpectedUpdatedAt(undefined)).toBe("");
    expect(
      pocketNoteExpectedUpdatedAt({
        text: "",
        updated_at: "2026-10-01T10:00:00Z",
      }),
    ).toBe("");
    expect(
      pocketNoteExpectedUpdatedAt({
        text: "Saved text",
        updated_at: "2026-10-01T10:00:00Z",
      }),
    ).toBe("2026-10-01T10:00:00Z");
  });

  it("identifies TeamHub 409 POCKET_NOTE_CONFLICT errors precisely", () => {
    expect(
      isPocketNoteConflictError(
        new TeamHubError({
          code: POCKET_NOTE_CONFLICT_CODE,
          message: "Changed elsewhere",
          status: 409,
        }),
      ),
    ).toBe(true);
    expect(
      isPocketNoteConflictError(
        new TeamHubError({
          code: "OTHER_CONFLICT",
          message: "Other",
          status: 409,
        }),
      ),
    ).toBe(false);
    expect(isPocketNoteConflictError(new Error("Network error"))).toBe(false);
  });

  it("merges shared-prefix extensions without duplicating the base and preserves divergent edits", () => {
    expect(
      mergePocketNoteConflict({
        baseText: "Morning",
        localText: "Morning\n\nBuy milk",
        serverText: "Morning\n\n> Alice\n>\n> Hello",
      }),
    ).toEqual({
      text: "Morning\n\n> Alice\n>\n> Hello\n\nBuy milk",
      truncated: false,
    });

    expect(
      mergePocketNoteConflict({
        baseText: "Original",
        localText: "Local rewrite",
        serverText: "Server rewrite",
      }),
    ).toEqual({
      text: "Server rewrite\n\nLocal rewrite",
      truncated: false,
    });

    expect(
      mergePocketNoteConflict({
        baseText: "",
        localText: "123456",
        maxLength: 8,
        serverText: "abcdef",
      }),
    ).toEqual({
      text: "abcdef\n\n",
      truncated: true,
    });
  });
});
