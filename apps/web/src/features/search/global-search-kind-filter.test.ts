import { describe, expect, it } from "vitest";

import {
  availableResultKinds,
  resultKindOptions,
  resultKindSections,
  settledResultKind,
} from "./global-search-kind-filter";
import type {
  GroupTab,
  ResultGroup,
  SearchResult,
} from "./global-search-model";

describe("result kind filter", () => {
  it("counts every kind and totals them under All", () => {
    const options = resultKindOptions({
      groups: [
        group("messages", 2),
        group("docs", 0),
        group("people", 1),
        group("rooms", 4),
      ],
      roomScoped: false,
      tab: "all",
    });

    expect(options).toEqual([
      { count: 7, tab: "all" },
      { count: 2, tab: "messages" },
      { count: 0, tab: "docs" },
      { count: 1, tab: "people" },
      { count: 4, tab: "rooms" },
    ]);
  });

  it("offers only the kinds the current search can produce", () => {
    expect(availableResultKinds({ roomScoped: true, tab: "all" })).toEqual([
      "messages",
    ]);
    expect(availableResultKinds({ roomScoped: false, tab: "docs" })).toEqual([
      "docs",
    ]);
    expect(availableResultKinds({ roomScoped: false, tab: "all" })).toEqual([
      "messages",
      "docs",
      "people",
      "rooms",
    ]);

    expect(
      resultKindOptions({
        groups: [group("messages", 3), group("docs", 2)],
        roomScoped: true,
        tab: "all",
      }),
    ).toEqual([
      { count: 3, tab: "all" },
      { count: 3, tab: "messages" },
    ]);
  });

  it("settles on All when the chosen kind holds no loaded rows", () => {
    const options = resultKindOptions({
      groups: [group("messages", 1), group("docs", 0)],
      roomScoped: false,
      tab: "all",
    });

    expect(settledResultKind("all", options)).toBe("all");
    expect(settledResultKind("messages", options)).toBe("messages");
    expect(settledResultKind("docs", options)).toBe("all");
    // A kind outside the current search has no count at all.
    expect(settledResultKind("rooms", options)).toBe("all");
  });

  it("previews three rows per kind under All and every loaded row of one kind", () => {
    const groups = [group("messages", 5), group("docs", 4)];

    const all = resultKindSections({
      docsLoading: false,
      groups,
      kind: "all",
      messagesLoading: false,
      tab: "all",
    });
    expect(all.map((section) => section.key)).toEqual(["messages", "docs"]);
    expect(all[0]!.items).toHaveLength(3);
    expect(all[0]!.seeAll).toBe("messages");

    const docs = resultKindSections({
      docsLoading: false,
      groups,
      kind: "docs",
      messagesLoading: false,
      tab: "all",
    });
    expect(docs.map((section) => section.key)).toEqual(["docs"]);
    expect(docs[0]!.items).toHaveLength(4);
    expect(docs[0]!.seeAll).toBeUndefined();
  });

  it("draws nothing for a kind that matched nothing and skeletons a loading one", () => {
    const groups = [group("messages", 0), group("docs", 0)];

    expect(
      resultKindSections({
        docsLoading: false,
        groups,
        kind: "docs",
        messagesLoading: false,
        tab: "all",
      }),
    ).toEqual([]);
    expect(
      resultKindSections({
        docsLoading: true,
        groups,
        kind: "docs",
        messagesLoading: false,
        tab: "all",
      }),
    ).toEqual([
      { items: [], key: "docs", label: "Docs", layout: "rows", loading: true },
    ]);
  });
});

function group(tab: GroupTab, count: number): ResultGroup {
  return {
    hasMore: false,
    items: Array.from(
      { length: count },
      (_, index): SearchResult => ({
        id: `${tab}-${index}`,
        kind: "query",
        text: `${tab} ${index}`,
      }),
    ),
    tab,
  };
}
