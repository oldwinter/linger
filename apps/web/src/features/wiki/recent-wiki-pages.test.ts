// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentWikiPage,
  clearAllRecentWikiPages,
  clearRecentWikiPages,
  hasRecentWikiPages,
  readRecentWikiPages,
  recordRecentWikiPage,
  removeRecentWikiPage,
  type RecentWikiPage,
  writeRecentWikiPages,
} from "./recent-wiki-pages";

const STORAGE_KEY = "wiki-recent-pages.v1:account-a";

function entry(id: string, openedAt = "2026-07-24T10:00:00Z"): RecentWikiPage {
  return {
    id,
    name: id,
    openedAt,
    path: `/t/tenant-a/documents/${id}`,
  };
}

describe("addRecentWikiPage", () => {
  it("puts the newest open first", () => {
    const first = addRecentWikiPage([], entry("a"));
    const second = addRecentWikiPage(first, entry("b"));

    expect(second.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("moves a reopened page to the front instead of repeating it", () => {
    const reopened = {
      ...entry("a", "2026-07-24T12:00:00Z"),
      name: "Renamed",
    };
    const rows = addRecentWikiPage([entry("b"), entry("a")], reopened);

    expect(rows).toEqual([reopened, entry("b")]);
  });

  it("keeps at most five pages and evicts the oldest", () => {
    const rows = ["a", "b", "c", "d", "e", "f"].reduce(
      (list, id) => addRecentWikiPage(list, entry(id)),
      [] as RecentWikiPage[],
    );

    expect(rows.map((row) => row.id)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("ignores an entry without an identity, name, or route", () => {
    const existing = [entry("a")];

    expect(addRecentWikiPage(existing, { ...entry("b"), id: " " })).toEqual(
      existing,
    );
    expect(addRecentWikiPage(existing, { ...entry("b"), name: "" })).toEqual(
      existing,
    );
    expect(addRecentWikiPage(existing, { ...entry("b"), path: " " })).toEqual(
      existing,
    );
  });
});

describe("Recent Wiki page storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads back the list it wrote for the Account", () => {
    writeRecentWikiPages("account-a", [entry("b"), entry("a")]);

    expect(readRecentWikiPages("account-a")).toEqual([entry("b"), entry("a")]);
  });

  it("keeps each Account's list separate", () => {
    writeRecentWikiPages("account-a", [entry("a")]);
    writeRecentWikiPages("account-b", [entry("b")]);

    expect(readRecentWikiPages("account-a").map((row) => row.id)).toEqual([
      "a",
    ]);
    expect(readRecentWikiPages("account-b").map((row) => row.id)).toEqual([
      "b",
    ]);
    expect(readRecentWikiPages("account-c")).toEqual([]);
  });

  it("drops stored rows that lost their identity, name, or route", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        entry("good"),
        { id: "", name: "Missing id", openedAt: "", path: "/t/a/documents/x" },
        { id: "nameless", name: "", openedAt: "", path: "/t/a/documents/x" },
        { id: "routeless", name: "No route", openedAt: "", path: "" },
        { id: "partial", name: "No time" },
      ]),
    );

    expect(readRecentWikiPages("account-a")).toEqual([entry("good")]);
  });

  it("returns nothing from storage it cannot read", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readRecentWikiPages("account-a")).toEqual([]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: "a" }));
    expect(readRecentWikiPages("account-a")).toEqual([]);
  });

  it("clears the stored list", () => {
    writeRecentWikiPages("account-a", [entry("a")]);

    clearRecentWikiPages("account-a");

    expect(readRecentWikiPages("account-a")).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("reports and clears the lists of every Account", () => {
    expect(hasRecentWikiPages()).toBe(false);

    writeRecentWikiPages("account-a", [entry("a")]);
    writeRecentWikiPages("account-b", [entry("b")]);
    localStorage.setItem("unrelated", "keep");

    expect(hasRecentWikiPages()).toBe(true);

    clearAllRecentWikiPages();

    expect(hasRecentWikiPages()).toBe(false);
    expect(readRecentWikiPages("account-a")).toEqual([]);
    expect(readRecentWikiPages("account-b")).toEqual([]);
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("records an open by moving the page to the front", () => {
    recordRecentWikiPage("account-a", entry("a"));
    recordRecentWikiPage("account-a", entry("b"));
    recordRecentWikiPage("account-a", entry("a", "2026-07-24T12:00:00Z"));

    expect(readRecentWikiPages("account-a").map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps no list without an Account", () => {
    recordRecentWikiPage(undefined, entry("a"));

    expect(localStorage.length).toBe(0);
    expect(readRecentWikiPages(undefined)).toEqual([]);
  });
});

describe("removeRecentWikiPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("forgets only the named page and keeps the rest in order", () => {
    writeRecentWikiPages("account-a", [entry("a"), entry("b"), entry("c")]);

    removeRecentWikiPage("account-a", "b");

    expect(readRecentWikiPages("account-a").map((row) => row.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("drops the Account's key when the last page goes", () => {
    writeRecentWikiPages("account-a", [entry("a")]);

    removeRecentWikiPage("account-a", "a");

    expect(readRecentWikiPages("account-a")).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasRecentWikiPages()).toBe(false);
  });

  it("leaves a list without that page as it is", () => {
    writeRecentWikiPages("account-a", [entry("a")]);
    const stored = localStorage.getItem(STORAGE_KEY);

    removeRecentWikiPage("account-a", "missing");

    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
  });

  it("leaves storage it cannot read untouched", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    removeRecentWikiPage("account-a", "a");

    expect(localStorage.getItem(STORAGE_KEY)).toBe("{not json");
  });

  it("removes nothing without an Account", () => {
    removeRecentWikiPage(undefined, "a");

    expect(localStorage.length).toBe(0);
  });
});
