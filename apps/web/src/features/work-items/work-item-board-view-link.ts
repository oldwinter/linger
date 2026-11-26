import {
  type WorkItemDashboardFilters,
  workItemDashboardFiltersSearch,
} from "./work-item-dashboard-filters";
import { dashboardPath } from "./work-item-routes";
import {
  type WorkItemDashboardSort,
  workItemDashboardSortSearch,
} from "./work-item-sort";
import {
  DEFAULT_WORK_ITEM_VIEW_MODE,
  type WorkItemViewMode,
  workItemDashboardViewSearch,
} from "./work-item-view-mode";

/**
 * The absolute link to the board in one view. The URL carries only the values
 * that differ from the board's defaults, in a fixed order, so one view has one
 * spelling whether the reader pastes it now or after more filters were tried.
 */
export function workItemBoardViewUrl({
  filters,
  origin,
  sort,
  tenantId,
  viewMode = DEFAULT_WORK_ITEM_VIEW_MODE,
}: {
  filters: WorkItemDashboardFilters;
  origin: string;
  sort: WorkItemDashboardSort;
  tenantId: string;
  viewMode?: WorkItemViewMode;
}): string {
  const search = workItemDashboardViewSearch(
    workItemDashboardSortSearch(workItemDashboardFiltersSearch(filters), sort),
    viewMode,
  );
  const url = `${origin}${dashboardPath(tenantId)}`;
  return search ? `${url}?${search}` : url;
}
