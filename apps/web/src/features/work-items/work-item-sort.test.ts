import { describe, expect, it } from "vitest";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import {
  createWorkItemDashboardSort,
  DEFAULT_WORK_ITEM_DASHBOARD_SORT,
  sortWorkItems,
  WORK_ITEM_DASHBOARD_SORTS,
  workItemDashboardSortSearch,
} from "./work-item-sort";

const actor: TeamHubWorkItem["created_by"] = {
  display_name: "Jenny",
  id: "actor-jenny",
  kind: "human",
  tenant_id: "tenant-northstar",
};

function item(
  id: string,
  override: Partial<TeamHubWorkItem> = {},
): TeamHubWorkItem {
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "",
    explicit_access_grants: [],
    id,
    kind: "issue",
    number: 1,
    priority: "medium",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: id,
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
}

function ids(items: readonly TeamHubWorkItem[]) {
  return items.map((workItem) => workItem.id);
}

describe("Work Item Dashboard sort model", () => {
  it("reads every order from the URL", () => {
    for (const sort of WORK_ITEM_DASHBOARD_SORTS) {
      expect(createWorkItemDashboardSort(sort)).toBe(sort);
    }
  });

  it("falls back to the board's own order for a missing or unknown value", () => {
    expect(createWorkItemDashboardSort(null)).toBe(
      DEFAULT_WORK_ITEM_DASHBOARD_SORT,
    );
    expect(createWorkItemDashboardSort("")).toBe(
      DEFAULT_WORK_ITEM_DASHBOARD_SORT,
    );
    expect(createWorkItemDashboardSort("oldest")).toBe(
      DEFAULT_WORK_ITEM_DASHBOARD_SORT,
    );
  });

  it("writes the sort only when it departs from the default", () => {
    expect(workItemDashboardSortSearch("", "updated")).toBe("");
    expect(workItemDashboardSortSearch("priority=high", "updated")).toBe(
      "priority=high",
    );
    expect(workItemDashboardSortSearch("priority=high", "newest")).toBe(
      "priority=high&sort=newest",
    );
  });

  it("orders by the most recently updated first, with a stable tie-break", () => {
    const items = [
      item("workitem-old", { updated_at: "2026-07-29T10:00:00Z" }),
      item("workitem-a", { updated_at: "2026-07-30T10:00:00Z" }),
      item("workitem-b", { updated_at: "2026-07-30T10:00:00Z" }),
    ];

    expect(ids(sortWorkItems(items, "updated"))).toEqual([
      "workitem-b",
      "workitem-a",
      "workitem-old",
    ]);
    expect(ids(items)).toEqual(["workitem-old", "workitem-a", "workitem-b"]);
  });

  it("orders by priority, most urgent first, then by recency", () => {
    const items = [
      item("workitem-low", { priority: "low" }),
      item("workitem-urgent-old", {
        priority: "urgent",
        updated_at: "2026-07-29T10:00:00Z",
      }),
      item("workitem-medium", { priority: "medium" }),
      item("workitem-urgent-new", {
        priority: "urgent",
        updated_at: "2026-07-31T10:00:00Z",
      }),
      item("workitem-high", { priority: "high" }),
    ];

    expect(ids(sortWorkItems(items, "priority"))).toEqual([
      "workitem-urgent-new",
      "workitem-urgent-old",
      "workitem-high",
      "workitem-medium",
      "workitem-low",
    ]);
  });

  it("orders by creation time, newest first, with a stable tie-break", () => {
    const items = [
      item("workitem-old", { created_at: "2026-07-01T10:00:00Z" }),
      item("workitem-a", { created_at: "2026-07-02T10:00:00Z" }),
      item("workitem-b", { created_at: "2026-07-02T10:00:00Z" }),
    ];

    expect(ids(sortWorkItems(items, "newest"))).toEqual([
      "workitem-b",
      "workitem-a",
      "workitem-old",
    ]);
  });
});
