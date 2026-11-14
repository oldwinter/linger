import {
  type WorkItemDashboardFilters,
  workItemDashboardFiltersSearch,
} from "./work-item-dashboard-filters";
import { dashboardPath } from "./work-item-routes";
import {
  type WorkItemDashboardSort,
  workItemDashboardSortSearch,
} from "./work-item-sort";

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
}: {
  filters: WorkItemDashboardFilters;
  origin: string;
  sort: WorkItemDashboardSort;
  tenantId: string;
}): string {
  const search = workItemDashboardSortSearch(
    workItemDashboardFiltersSearch(filters),
    sort,
  );
  const url = `${origin}${dashboardPath(tenantId)}`;
  return search ? `${url}?${search}` : url;
}
