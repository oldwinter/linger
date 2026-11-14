import { useState } from "react";

import { ModalDialog } from "@/components/ui/modal-dialog";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  resultKindOptions,
  settledResultKind,
} from "./global-search-kind-filter";
import { SCOPES, type GlobalSearchTab } from "./global-search-model";
import { removeGlobalSearchQuery } from "./global-search-recent";
import type { SearchRoomScope } from "./room-search-scope";
import {
  GlobalSearchField,
  GlobalSearchFooter,
  GlobalSearchKindFilter,
  GlobalSearchResultList,
} from "./global-search-sections";
import {
  useOpenResult,
  useRecordRecentQuery,
  useVoiceSearchBridge,
} from "./use-global-search-actions";
import {
  useActiveRow,
  usePointerSteering,
} from "./use-global-search-navigation";
import {
  useGlobalSearchState,
  useResultSections,
  useSearchGroups,
} from "./use-global-search-results";

export function GlobalSearchDialog({
  initialQuery = "",
  onClose,
  room,
  tenantId,
}: {
  /** Opens with this text already searched, as a spoken search does. */
  initialQuery?: string;
  onClose: () => void;
  /** Opens narrowed to one Room; clearing the chip returns to global search. */
  room?: SearchRoomScope;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const [roomScope, setRoomScope] = useState(room);
  const [kind, setKind] = useState<GlobalSearchTab>("all");
  const {
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
  } = useGlobalSearchState(initialQuery, tenantId);
  const debouncedQuery = debounced.normalized;
  // A Room scope is a Message-only search; the type scope stays available once
  // the chip is cleared.
  const activeTab: GlobalSearchTab = roomScope ? "messages" : tab;
  const {
    directRoomIdByPeer,
    docsLoading,
    error,
    groups,
    messagesLoading,
    pending,
    targetContext,
  } = useSearchGroups({
    client,
    debouncedQuery,
    roomId: roomScope?.id,
    tab: activeTab,
    tenantId,
  });
  const kindOptions = resultKindOptions({
    groups,
    roomScoped: roomScope !== undefined,
    tab: activeTab,
  });
  // Filtering happens over the rows already loaded, so the chosen kind never
  // changes the request; a kind whose rows are gone settles on All.
  const activeKind = settledResultKind(kind, kindOptions);
  const { layoutKey, rows, rowsKey, sections, showingStart } =
    useResultSections({
      debouncedQuery,
      docsLoading,
      groups,
      kind: activeKind,
      messagesLoading,
      setStore,
      store,
      tab: activeTab,
      tenantId,
    });
  const { openError, openResult } = useOpenResult({
    client,
    debouncedRaw: debounced.raw,
    directRoomIdByPeer,
    enterScope,
    onClose,
    query,
    runQuery,
    setStore,
    targetContext,
    tenantId,
  });
  const activeRow = useActiveRow({
    layoutKey,
    onClose,
    onRemoveRecentQuery: removeRecentQuery,
    openResult,
    query,
    rows,
    rowsKey,
    setTab,
    tab: activeTab,
  });
  useRecordRecentQuery({
    debouncedRaw: debounced.raw,
    hasResults: rows.length > 0 && !showingStart,
    pending,
    setStore,
    tenantId,
  });
  useVoiceSearchBridge({
    onClose,
    openResult,
    rows,
    setQuery,
    setTab,
    targetContext,
  });
  const { hoverRow, onListLeave, onListScroll } = usePointerSteering(activeRow);

  function clearRoomScope() {
    setRoomScope(undefined);
    setTab("all");
    setKind("all");
    inputRef.current?.focus();
  }

  function removeRecentQuery(text: string) {
    setStore(removeGlobalSearchQuery(tenantId, text));
    inputRef.current?.focus();
  }

  const scope = activeTab === "all" ? undefined : SCOPES[activeTab];
  // The chips report rows already loaded, so they wait for a search or a
  // scope that browses a list.
  const showKindFilter =
    !showingStart && (debouncedQuery !== "" || rows.length > 0);

  return (
    <ModalDialog
      ariaLabel="Search"
      className="global-search flex flex-col overflow-hidden"
      closeOnBackdrop
      onClose={onClose}
      size="md"
    >
      <GlobalSearchField
        activeIndex={activeRow.activeIndex}
        enterScope={enterScope}
        inputRef={inputRef}
        onClose={onClose}
        onInputKeyDown={activeRow.onInputKeyDown}
        onClearRoomScope={clearRoomScope}
        onQueryChange={(value) => {
          setQuery(value);
          activeRow.setHighlightShown(true);
        }}
        pending={pending}
        query={query}
        roomScope={roomScope}
        rowCount={rows.length}
        scope={scope}
        tab={activeTab}
      />
      {showKindFilter ? (
        <GlobalSearchKindFilter
          kind={activeKind}
          onSelect={(next) => {
            setKind(next);
            inputRef.current?.focus();
          }}
          options={kindOptions}
        />
      ) : null}
      <GlobalSearchResultList
        activeIndex={activeRow.activeIndex}
        debouncedQuery={debouncedQuery}
        debouncedRaw={debounced.raw}
        enterScope={enterScope}
        error={error}
        highlightShown={activeRow.highlightShown}
        hoverRow={hoverRow}
        indicatorRef={activeRow.indicatorRef}
        inputRef={inputRef}
        listRef={activeRow.listRef}
        onListLeave={onListLeave}
        onListScroll={onListScroll}
        onRemoveRecent={removeRecentQuery}
        openResult={openResult}
        roomScoped={roomScope !== undefined}
        scope={scope}
        sections={sections}
        tab={activeTab}
        targetContext={targetContext}
      />
      <GlobalSearchFooter
        openError={openError}
        recentSelected={rows[activeRow.activeIndex]?.kind === "query"}
      />
    </ModalDialog>
  );
}
