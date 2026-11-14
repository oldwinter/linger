// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearGlobalSearchHistory,
  hasGlobalSearchHistory,
  readGlobalSearchStore,
  recordGlobalSearchQuery,
} from "./global-search-recent";

describe("global search history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers queries per Tenant and reads them back newest first", () => {
    recordGlobalSearchQuery("tenant-a", "first");
    recordGlobalSearchQuery("tenant-a", "second");

    expect(readGlobalSearchStore("tenant-a").queries).toEqual([
      "second",
      "first",
    ]);
    expect(readGlobalSearchStore("tenant-b").queries).toEqual([]);
  });

  it("reports and clears the history of every Tenant", () => {
    expect(hasGlobalSearchHistory()).toBe(false);

    recordGlobalSearchQuery("tenant-a", "first");
    recordGlobalSearchQuery("tenant-b", "second");
    localStorage.setItem("unrelated", "keep");

    expect(hasGlobalSearchHistory()).toBe(true);

    clearGlobalSearchHistory();

    expect(hasGlobalSearchHistory()).toBe(false);
    expect(readGlobalSearchStore("tenant-a").queries).toEqual([]);
    expect(readGlobalSearchStore("tenant-b").queries).toEqual([]);
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
