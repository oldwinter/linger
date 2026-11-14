import { describe, expect, it } from "vitest";

import {
  createWorkItemDashboardFilters,
  EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
  type WorkItemDashboardFilters,
} from "./work-item-dashboard-filters";
import { workItemBoardViewUrl } from "./work-item-board-view-link";
import {
  createWorkItemDashboardSort,
  DEFAULT_WORK_ITEM_DASHBOARD_SORT,
  type WorkItemDashboardSort,
} from "./work-item-sort";

const origin = "https://app.example";
const tenantId = "tenant-northstar";
const boardUrl = "https://app.example/t/tenant-northstar/dashboard";

function viewUrl(
  filters: WorkItemDashboardFilters,
  sort: WorkItemDashboardSort = DEFAULT_WORK_ITEM_DASHBOARD_SORT,
) {
  return workItemBoardViewUrl({ filters, origin, sort, tenantId });
}

describe("workItemBoardViewUrl", () => {
  it("writes the bare board path when nothing narrows it", () => {
    expect(viewUrl({ ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS })).toBe(boardUrl);
  });

  it("keeps only the title query", () => {
    expect(
      viewUrl({ ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS, text: "release PLAN" }),
    ).toBe(`${boardUrl}?q=release+PLAN`);
  });

  it("writes every filter in one order, whatever order they were set in", () => {
    const first: WorkItemDashboardFilters = {
      room: "room-gtm-launch",
      text: "release PLAN",
      priority: "high",
      assignment: "mine",
      execution: "running",
      archived: true,
    };
    const second: WorkItemDashboardFilters = {
      archived: true,
      execution: "running",
      assignment: "mine",
      priority: "high",
      text: "release PLAN",
      room: "room-gtm-launch",
    };

    expect(viewUrl(first, "priority")).toBe(
      `${boardUrl}?room=room-gtm-launch&q=release+PLAN&priority=high&assignment=mine&execution=running&archived=true&sort=priority`,
    );
    expect(viewUrl(second, "priority")).toBe(viewUrl(first, "priority"));
  });

  it("drops a sort at the default and keeps one that differs", () => {
    expect(viewUrl({ ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS }, "updated")).toBe(
      boardUrl,
    );
    expect(viewUrl({ ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS }, "newest")).toBe(
      `${boardUrl}?sort=newest`,
    );
  });

  it("encodes spaces and text outside ASCII", () => {
    expect(
      viewUrl({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        text: "設計 review",
      }),
    ).toBe(`${boardUrl}?q=%E8%A8%AD%E8%A8%88+review`);
  });

  it("parses back into the view it links to", () => {
    const filters: WorkItemDashboardFilters = {
      archived: true,
      assignment: "unassigned",
      execution: "waiting_for_approval",
      priority: "urgent",
      room: "room-gtm-launch",
      text: "設計 review",
    };

    const url = new URL(viewUrl(filters, "newest"));

    expect(createWorkItemDashboardFilters(url.searchParams)).toEqual(filters);
    expect(createWorkItemDashboardSort(url.searchParams.get("sort"))).toBe(
      "newest",
    );
  });

  it("parses the bare link back to the default board", () => {
    const params = new URL(viewUrl({ ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS }))
      .searchParams;

    expect(createWorkItemDashboardFilters(params)).toEqual(
      EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
    );
    expect(createWorkItemDashboardSort(params.get("sort"))).toBe(
      DEFAULT_WORK_ITEM_DASHBOARD_SORT,
    );
  });
});
