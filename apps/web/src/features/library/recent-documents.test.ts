// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentDocument,
  clearAllRecentDocuments,
  clearRecentDocuments,
  hasRecentDocuments,
  type RecentDocument,
  readRecentDocuments,
  recordRecentDocument,
  removeRecentDocument,
  writeRecentDocuments,
} from "./recent-documents";

const STORAGE_KEY = "library-recent-documents.v1:account-a.tenant-a";

function entry(id: string, openedAt = "2026-07-24T10:00:00Z"): RecentDocument {
  return { formatLabel: "md", id, name: id, openedAt };
}

describe("addRecentDocument", () => {
  it("puts the newest open first", () => {
    const first = addRecentDocument([], entry("a"));
    const second = addRecentDocument(first, entry("b"));

    expect(second.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("moves a reopened Document to the front instead of repeating it", () => {
    const reopened = {
      ...entry("a", "2026-07-24T12:00:00Z"),
      name: "Renamed",
    };
    const rows = addRecentDocument([entry("b"), entry("a")], reopened);

    expect(rows).toEqual([reopened, entry("b")]);
  });

  it("keeps at most five Documents", () => {
    const rows = ["a", "b", "c", "d", "e", "f"].reduce(
      (list, id) => addRecentDocument(list, entry(id)),
      [] as RecentDocument[],
    );

    expect(rows.map((row) => row.id)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("ignores an entry without an id or name", () => {
    const existing = [entry("a")];

    expect(addRecentDocument(existing, { ...entry("b"), id: " " })).toEqual(
      existing,
    );
    expect(addRecentDocument(existing, { ...entry("b"), name: "" })).toEqual(
      existing,
    );
  });
});

describe("Recent Document storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads back the list it wrote for the Account and Tenant", () => {
    writeRecentDocuments("account-a", "tenant-a", [entry("b"), entry("a")]);
    writeRecentDocuments("account-a", "tenant-b", [entry("c")]);

    expect(readRecentDocuments("account-a", "tenant-a")).toEqual([
      entry("b"),
      entry("a"),
    ]);
    expect(readRecentDocuments("account-a", "tenant-b")).toEqual([entry("c")]);
    expect(readRecentDocuments("account-b", "tenant-a")).toEqual([]);
  });

  it("drops the key when writing an empty list", () => {
    writeRecentDocuments("account-a", "tenant-a", [entry("a")]);
    writeRecentDocuments("account-a", "tenant-a", []);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasRecentDocuments()).toBe(false);
  });

  it("drops stored rows without an id or name", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        entry("good"),
        { formatLabel: "md", id: "", name: "Missing id", openedAt: "" },
        { formatLabel: "md", id: "nameless", openedAt: "" },
      ]),
    );

    expect(readRecentDocuments("account-a", "tenant-a")).toEqual([
      entry("good"),
    ]);
  });

  it("returns nothing from storage it cannot read", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readRecentDocuments("account-a", "tenant-a")).toEqual([]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: "a" }));
    expect(readRecentDocuments("account-a", "tenant-a")).toEqual([]);
  });

  it("clears the stored list", () => {
    writeRecentDocuments("account-a", "tenant-a", [entry("a")]);

    clearRecentDocuments("account-a", "tenant-a");

    expect(readRecentDocuments("account-a", "tenant-a")).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("reports and clears the lists of every Account", () => {
    expect(hasRecentDocuments()).toBe(false);

    writeRecentDocuments("account-a", "tenant-a", [entry("a")]);
    writeRecentDocuments("account-b", "tenant-a", [entry("b")]);
    localStorage.setItem("unrelated", "keep");

    expect(hasRecentDocuments()).toBe(true);

    clearAllRecentDocuments();

    expect(hasRecentDocuments()).toBe(false);
    expect(readRecentDocuments("account-a", "tenant-a")).toEqual([]);
    expect(readRecentDocuments("account-b", "tenant-a")).toEqual([]);
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("records an open by moving the Document to the front", () => {
    recordRecentDocument("account-a", "tenant-a", entry("a"));
    recordRecentDocument("account-a", "tenant-a", entry("b"));
    recordRecentDocument(
      "account-a",
      "tenant-a",
      entry("a", "2026-07-24T12:00:00Z"),
    );

    expect(
      readRecentDocuments("account-a", "tenant-a").map((row) => row.id),
    ).toEqual(["a", "b"]);
  });

  it("keeps no list without an Account or Tenant", () => {
    recordRecentDocument(undefined, "tenant-a", entry("a"));
    recordRecentDocument("account-a", undefined, entry("a"));

    expect(localStorage.length).toBe(0);
    expect(readRecentDocuments(undefined, "tenant-a")).toEqual([]);
    expect(readRecentDocuments("account-a", undefined)).toEqual([]);
  });

  it("forgets one Document and keeps the rest in order", () => {
    writeRecentDocuments("account-a", "tenant-a", [
      entry("a"),
      entry("b"),
      entry("c"),
    ]);
    writeRecentDocuments("account-b", "tenant-a", [entry("a"), entry("b")]);

    removeRecentDocument("account-a", "tenant-a", "b");

    expect(
      readRecentDocuments("account-a", "tenant-a").map((row) => row.id),
    ).toEqual(["a", "c"]);
    expect(
      readRecentDocuments("account-b", "tenant-a").map((row) => row.id),
    ).toEqual(["a", "b"]);
  });

  it("drops the stored list when the last Document is forgotten", () => {
    writeRecentDocuments("account-a", "tenant-a", [entry("a")]);

    removeRecentDocument("account-a", "tenant-a", "a");

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasRecentDocuments()).toBe(false);
  });

  it("leaves a missing or unreadable list alone", () => {
    removeRecentDocument("account-a", "tenant-a", "a");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    localStorage.setItem(STORAGE_KEY, "{not json");
    removeRecentDocument("account-a", "tenant-a", "a");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{not json");

    writeRecentDocuments("account-a", "tenant-a", [entry("a")]);
    removeRecentDocument("account-a", "tenant-a", "missing");
    expect(
      readRecentDocuments("account-a", "tenant-a").map((row) => row.id),
    ).toEqual(["a"]);
  });
});
