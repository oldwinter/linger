import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import {
  archiveWorkItemRequest,
  refreshWorkItemsAfterArchive,
} from "./work-item-queries";
import {
  describeWorkItemArchiveOutcome,
  hasSelectedAllVisibleWorkItems,
  retainVisibleWorkItemSelection,
  selectAllVisibleWorkItems,
  toggleWorkItemSelection,
  type WorkItemArchiveOutcome,
} from "./work-item-selection";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/**
 * Multi-select over the cards the board shows. Archive runs the existing
 * single-Item request once per selected Item, so a partial failure keeps the
 * failed cards selected and reported instead of reading as success. The
 * selection is view state: it never reaches the URL, and a card that leaves
 * the visible set leaves the selection.
 */
export function useWorkItemSelection({
  items,
  tenantId,
}: {
  /** The cards the board shows, in display order. */
  items: readonly TeamHubWorkItem[];
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] =
    useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<WorkItemArchiveOutcome | null>(null);
  const visibleIdsKey = items.map((item) => item.id).join("\n");
  const visibleIds = useMemo(
    () => (visibleIdsKey ? visibleIdsKey.split("\n") : []),
    [visibleIdsKey],
  );
  // A filter, sort, or collapsed column that hides a selected card drops it,
  // so the count always describes the cards on screen.
  useEffect(() => {
    setSelectedIds((current) =>
      retainVisibleWorkItemSelection(current, visibleIds),
    );
  }, [visibleIds]);
  // The same narrowing at render time, so the count never shows a card the
  // board already stopped showing while the effect catches up.
  const visibleSelectedIds = useMemo(
    () => retainVisibleWorkItemSelection(selectedIds, visibleIds),
    [selectedIds, visibleIds],
  );

  function toggle(workItemId: string) {
    setSelectedIds((current) => toggleWorkItemSelection(current, workItemId));
  }

  function selectAll() {
    setSelectedIds(selectAllVisibleWorkItems(visibleIds));
  }

  /** Empties the selection but keeps the last archive report readable. */
  function deselectAll() {
    setSelectedIds(EMPTY_SELECTION);
  }

  function clear() {
    setSelectedIds(EMPTY_SELECTION);
    setOutcome(null);
  }

  async function archive() {
    const targets = items.filter((item) => visibleSelectedIds.has(item.id));
    if (targets.length === 0 || pending) return;
    setPending(true);
    setOutcome(null);
    try {
      const results = await Promise.allSettled(
        targets.map((item) =>
          archiveWorkItemRequest(client, item.id, item.version),
        ),
      );
      const archived = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = targets.filter(
        (_item, index) => results[index]?.status === "rejected",
      );
      refreshWorkItemsAfterArchive(queryClient, tenantId, archived);
      // Only the failures stay selected, so Archive again retries just them.
      setSelectedIds(new Set(failed.map((item) => item.id)));
      setOutcome(describeWorkItemArchiveOutcome(archived.length, failed));
    } finally {
      setPending(false);
    }
  }

  return {
    allSelected: hasSelectedAllVisibleWorkItems(visibleSelectedIds, visibleIds),
    archive,
    clear,
    count: visibleSelectedIds.size,
    deselectAll,
    isSelected: (workItemId: string) => visibleSelectedIds.has(workItemId),
    outcome,
    pending,
    selectAll,
    toggle,
  };
}
