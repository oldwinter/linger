import { Link01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import type { WorkItemDashboardFilters } from "./work-item-dashboard-filters";
import { WorkItemCopyStatus } from "./work-item-copy-status";
import type { WorkItemDashboardSort } from "./work-item-sort";
import { workItemBoardViewUrl } from "./work-item-board-view-link";
import { useWorkItemClipboardCopy } from "./use-work-item-copy";

/** Copies the board's current view as a link, reporting the outcome beside it. */
export function WorkItemBoardViewLinkAction({
  filters,
  sort,
  tenantId,
}: {
  filters: WorkItemDashboardFilters;
  sort: WorkItemDashboardSort;
  tenantId: string;
}) {
  const { copy, copiedLabel, state } = useWorkItemClipboardCopy();

  return (
    <span className="relative inline-flex">
      <Button
        onClick={() =>
          copy(
            workItemBoardViewUrl({
              filters,
              origin: window.location.origin,
              sort,
              tenantId,
            }),
          )
        }
        size="compact"
        tone="secondary"
      >
        <Icon icon={Link01Icon} size={14} />
        Copy view link
      </Button>
      <WorkItemCopyStatus copiedLabel={copiedLabel} state={state} />
    </span>
  );
}
