// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentDocument,
  clearRecentDocuments,
  type RecentDocument,
  readRecentDocuments,
  recordRecentDocument,
  writeRecentDocuments,
} from "./recent-documents";

const STORAGE_KEY = "library-recent-documents.v1:account-a";

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

  it("reads back the list it wrote for the Account", () => {
    writeRecentDocuments("account-a", [entry("b"), entry("a")]);

    expect(readRecentDocuments("account-a")).toEqual([entry("b"), entry("a")]);
    expect(readRecentDocuments("account-b")).toEqual([]);
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

    expect(readRecentDocuments("account-a")).toEqual([entry("good")]);
  });

  it("returns nothing from storage it cannot read", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readRecentDocuments("account-a")).toEqual([]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: "a" }));
    expect(readRecentDocuments("account-a")).toEqual([]);
  });

  it("clears the stored list", () => {
    writeRecentDocuments("account-a", [entry("a")]);

    clearRecentDocuments("account-a");

    expect(readRecentDocuments("account-a")).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("records an open by moving the Document to the front", () => {
    recordRecentDocument("account-a", entry("a"));
    recordRecentDocument("account-a", entry("b"));
    recordRecentDocument("account-a", entry("a", "2026-07-24T12:00:00Z"));

    expect(readRecentDocuments("account-a").map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps no list without an Account", () => {
    recordRecentDocument(undefined, entry("a"));

    expect(localStorage.length).toBe(0);
    expect(readRecentDocuments(undefined)).toEqual([]);
  });
});
