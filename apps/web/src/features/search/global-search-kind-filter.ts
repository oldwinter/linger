import {
  ALL_TAB_GROUP_LIMIT,
  GROUP_ORDER,
  SCOPES,
  scopeText,
  type GlobalSearchTab,
  type GroupTab,
  type ResultGroup,
  type ResultSection,
} from "./global-search-model";

export interface ResultKindOption {
  /** Rows already loaded for the kind; All carries their total. */
  count: number;
  tab: GlobalSearchTab;
}

/** The kinds the current search can produce: a Room scope is Message-only, a
 * type scope holds one kind, and All holds every kind. */
export function availableResultKinds({
  roomScoped,
  tab,
}: {
  roomScoped: boolean;
  tab: GlobalSearchTab;
}): GroupTab[] {
  if (roomScoped) return ["messages"];
  return tab === "all" ? [...GROUP_ORDER] : [tab];
}

/** The filter chips above the results: All first, then every available kind. */
export function resultKindOptions({
  groups,
  roomScoped,
  tab,
}: {
  groups: readonly ResultGroup[];
  roomScoped: boolean;
  tab: GlobalSearchTab;
}): ResultKindOption[] {
  const counts = new Map<GroupTab, number>(
    groups.map((group) => [group.tab, group.items.length]),
  );
  const kinds = availableResultKinds({ roomScoped, tab }).map((kind) => ({
    count: counts.get(kind) ?? 0,
    tab: kind,
  }));
  return [
    {
      count: kinds.reduce((total, kind) => total + kind.count, 0),
      tab: "all",
    },
    ...kinds,
  ];
}

/** A chosen kind whose results are gone falls back to All, never to an empty
 * list. */
export function settledResultKind(
  kind: GlobalSearchTab,
  options: readonly ResultKindOption[],
): GlobalSearchTab {
  if (kind === "all") return "all";
  const count = options.find((option) => option.tab === kind)?.count ?? 0;
  return count > 0 ? kind : "all";
}

/** The live result sections: All previews a few rows per kind, a chosen kind
 * shows every row already loaded for it. */
export function resultKindSections({
  docsLoading,
  groups,
  kind,
  messagesLoading,
  tab,
}: {
  docsLoading: boolean;
  groups: readonly ResultGroup[];
  kind: GlobalSearchTab;
  messagesLoading: boolean;
  tab: GlobalSearchTab;
}): ResultSection[] {
  const narrowed = tab !== "all" || kind !== "all";
  return groups
    .filter(
      (group) =>
        (tab === "all" || group.tab === tab) &&
        (kind === "all" || group.tab === kind),
    )
    .flatMap((group): ResultSection[] => {
      const label = scopeText(SCOPES[group.tab].label);
      const loading =
        (group.tab === "messages" && messagesLoading) ||
        (group.tab === "docs" && docsLoading);
      if (loading) {
        return [
          { items: [], key: group.tab, label, layout: "rows", loading: true },
        ];
      }
      if (group.items.length === 0) return [];
      if (narrowed) {
        return [{ items: group.items, key: group.tab, label, layout: "rows" }];
      }
      return [
        {
          items: group.items.slice(0, ALL_TAB_GROUP_LIMIT),
          key: group.tab,
          label,
          layout: "rows",
          ...(group.items.length > ALL_TAB_GROUP_LIMIT || group.hasMore
            ? { seeAll: group.tab }
            : {}),
        },
      ];
    });
}
