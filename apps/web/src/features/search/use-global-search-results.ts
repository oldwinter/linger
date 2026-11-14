import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQuery } from "@tanstack/react-query";

import {
  tenantAgentsQueryOptions,
  tenantRoomsQueryOptions,
} from "@/features/rooms/room-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";

import {
  clearGlobalSearchQueries,
  readGlobalSearchStore,
  type GlobalSearchStore,
} from "./global-search-recent";
import { resultKindSections } from "./global-search-kind-filter";
import {
  BACKEND_PAGE_LIMIT,
  byName,
  GROUP_ORDER,
  matchRank,
  MIN_BACKEND_QUERY_LENGTH,
  SCOPE_ORDER,
  type GlobalSearchTab,
  type GroupTab,
  type ResultGroup,
  type ResultSection,
  type SearchResult,
  type TargetContext,
} from "./global-search-model";
import { matchesSearchQuery, normalizeSearchQuery } from "./search-text";

/** The typed text, its debounced form, the type scope and Recent searches. */
export function useGlobalSearchState(initialQuery: string, tenantId: string) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState({ normalized: "", raw: "" });
  const [tab, setTab] = useState<GlobalSearchTab>("all");
  const [store, setStore] = useState(() => readGlobalSearchStore(tenantId));

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setDebounced({
          normalized: normalizeSearchQuery(query),
          raw: query.trim(),
        }),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  function enterScope(next: GlobalSearchTab) {
    setTab(next);
    inputRef.current?.focus();
  }

  function runQuery(text: string) {
    setQuery(text);
    setTab("all");
    inputRef.current?.focus();
  }

  return {
    debounced,
    enterScope,
    inputRef,
    query,
    runQuery,
    setQuery,
    setStore,
    setTab,
    store,
    tab,
  };
}

/** The cached Agent and Room lists plus the backend searches, grouped by type. */
export function useSearchGroups({
  client,
  debouncedQuery,
  roomId,
  tab,
  tenantId,
}: {
  client: TeamHubClient;
  debouncedQuery: string;
  /** A Room scope narrows Message search to that Room and hides every other type. */
  roomId?: string;
  tab: GlobalSearchTab;
  tenantId: string;
}) {
  const backendQuery =
    debouncedQuery.length >= MIN_BACKEND_QUERY_LENGTH ? debouncedQuery : "";
  const roomScoped = roomId !== undefined;
  const wantsMessages = roomScoped || tab === "all" || tab === "messages";
  const wantsDocs = !roomScoped && (tab === "all" || tab === "docs");

  const agents = useQuery(tenantAgentsQueryOptions(client, tenantId));
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));

  // Each search runs only where its group shows, and its signal cancels the
  // request once a newer query replaces it.
  const messageSearch = useQuery({
    enabled: backendQuery !== "" && wantsMessages,
    queryFn: ({ signal }) =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/messages/search", {
          params: {
            path: { tenantId },
            query: {
              limit: BACKEND_PAGE_LIMIT,
              q: backendQuery,
              ...(roomId ? { room_id: roomId } : {}),
            },
          },
          signal,
        }),
      ),
    queryKey: [
      "teamhub",
      tenantId,
      "message-search",
      backendQuery,
      roomId ?? "",
    ],
  });
  const documentSearch = useQuery({
    enabled: backendQuery !== "" && wantsDocs,
    queryFn: ({ signal }) =>
      teamHubData(
        client.api.GET("/v0/library/documents/search", {
          params: {
            query: {
              limit: BACKEND_PAGE_LIMIT,
              q: backendQuery,
              tenant_id: tenantId,
            },
          },
          signal,
        }),
      ),
    queryKey: ["teamhub", tenantId, "document-search", backendQuery],
  });

  const roomNames = useMemo(
    () =>
      new Map(
        (rooms.data?.items ?? []).map((room) => [room.id, room.name] as const),
      ),
    [rooms.data?.items],
  );
  const directRoomIdByPeer = useMemo(
    () =>
      new Map(
        (rooms.data?.items ?? []).flatMap((room) =>
          room.kind === "direct" && room.direct_peer
            ? [[room.direct_peer.id, room.id] as const]
            : [],
        ),
      ),
    [rooms.data?.items],
  );
  const targetContext = useMemo<TargetContext>(
    () => ({ directRoomIdByPeer, roomNames, tenantId }),
    [directRoomIdByPeer, roomNames, tenantId],
  );

  const groups = useMemo<ResultGroup[]>(() => {
    // An empty field inside the Members or Rooms scope browses the whole list.
    const matches = (values: ReadonlyArray<string | null | undefined>) =>
      debouncedQuery === "" || matchesSearchQuery(debouncedQuery, values);
    // Members lists Agents: name matches first, then matches on handle or
    // description, each group by name. An Agent's row opens the conversation
    // with it, so Direct Rooms are not listed twice.
    const people = [
      ...(agents.data?.items ?? [])
        .filter((agent) =>
          matches([
            agent.actor.display_name,
            agent.actor.handle,
            agent.description,
          ]),
        )
        .map((agent) => ({
          name: agent.actor.display_name,
          rank: matchRank(debouncedQuery, agent.actor.display_name),
          result: {
            agent,
            id: agent.actor.id,
            kind: "agent" as const,
          },
        })),
    ]
      .sort(
        (left, right) =>
          left.rank - right.rank || left.name.localeCompare(right.name),
      )
      .map((entry) => entry.result);
    const roomHits = (rooms.data?.items ?? [])
      .filter(
        (room) =>
          // Direct Rooms are reached through their Agent's Members row.
          room.kind !== "direct" &&
          // A thread is reachable only through its parent Room and root Message.
          (room.kind !== "thread" ||
            (room.parent_room_id !== undefined &&
              room.root_message_id !== undefined)) &&
          matches([room.name, room.description]),
      )
      .sort(byName((room) => room.name))
      .map((room): SearchResult => ({ id: room.id, kind: "room", room }));
    const documents = (documentSearch.data?.items ?? []).map(
      (document): SearchResult => ({
        document,
        id: document.id,
        kind: "document",
      }),
    );
    const messages = (messageSearch.data?.items ?? []).map(
      (hit): SearchResult => ({ hit, id: hit.message.id, kind: "message" }),
    );
    const byTab: Record<GroupTab, ResultGroup> = {
      docs: {
        hasMore: documentSearch.data?.page.has_more === true,
        items: documents,
        tab: "docs",
      },
      messages: {
        hasMore: messageSearch.data?.page.has_more === true,
        items: messages,
        tab: "messages",
      },
      people: { hasMore: false, items: people, tab: "people" },
      rooms: { hasMore: false, items: roomHits, tab: "rooms" },
    };
    return GROUP_ORDER.map((groupTab) => byTab[groupTab]);
  }, [
    agents.data?.items,
    debouncedQuery,
    documentSearch.data,
    messageSearch.data,
    rooms.data?.items,
  ]);

  const messagesLoading =
    backendQuery !== "" && messageSearch.isPending && messageSearch.isFetching;
  const docsLoading =
    backendQuery !== "" &&
    documentSearch.isPending &&
    documentSearch.isFetching;
  const pending =
    (wantsMessages && messagesLoading) || (wantsDocs && docsLoading);
  const error =
    (wantsMessages ? messageSearch.error : null) ??
    (wantsDocs ? documentSearch.error : null);

  return {
    directRoomIdByPeer,
    docsLoading,
    error,
    groups,
    messagesLoading,
    pending,
    targetContext,
  };
}

/** The sections drawn for the current scope and kind, and the flat row order
 * keys walk. */
export function useResultSections({
  debouncedQuery,
  docsLoading,
  groups,
  kind,
  messagesLoading,
  setStore,
  store,
  tab,
  tenantId,
}: {
  debouncedQuery: string;
  docsLoading: boolean;
  groups: ResultGroup[];
  kind: GlobalSearchTab;
  messagesLoading: boolean;
  setStore: Dispatch<SetStateAction<GlobalSearchStore>>;
  store: GlobalSearchStore;
  tab: GlobalSearchTab;
  tenantId: string;
}) {
  const showingStart = debouncedQuery === "" && tab === "all";
  const sections = useMemo<ResultSection[]>(() => {
    if (showingStart) {
      const startSections: ResultSection[] = [
        {
          items: SCOPE_ORDER.map(
            (groupTab): SearchResult => ({
              id: `scope:${groupTab}`,
              kind: "scope",
              tab: groupTab,
            }),
          ),
          key: "search-in",
          label: "Search in",
          layout: "scopes",
        },
      ];
      if (store.queries.length > 0) {
        startSections.push({
          action: {
            label: "Clear",
            onSelect: () => setStore(clearGlobalSearchQueries(tenantId)),
          },
          items: store.queries.map(
            (text): SearchResult => ({
              id: `query:${text}`,
              kind: "query",
              text,
            }),
          ),
          key: "recent-searches",
          label: "Recent",
          layout: "rows",
        });
      }
      return startSections;
    }
    return resultKindSections({
      docsLoading,
      groups,
      kind,
      messagesLoading,
      tab,
    });
  }, [
    docsLoading,
    groups,
    kind,
    messagesLoading,
    setStore,
    showingStart,
    store,
    tab,
    tenantId,
  ]);
  const rows = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );
  const rowsKey = rows.map((row) => row.id).join("\u0000");
  // Sections settling (a skeleton giving way or an empty group dropping out)
  // move rows without changing their ids, so the tile also follows this.
  const layoutKey = sections
    .map((section) => `${section.key}:${section.loading ? 1 : 0}`)
    .join("\u0000");

  return { layoutKey, rows, rowsKey, sections, showingStart };
}
