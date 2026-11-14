import { describe, expect, it } from "vitest";

import {
  createWorkItemDashboardFilters,
  currentDashboardActorId,
  EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
  hasWorkItemDashboardFilters,
  workItemDashboardFiltersSearch,
  workItemDashboardListFilterSearch,
  workItemDashboardListQuery,
} from "./work-item-dashboard-filters";

describe("Work Item Dashboard filter model", () => {
  it("reads every filter from the URL and ignores unknown values", () => {
    expect(
      createWorkItemDashboardFilters(
        new URLSearchParams(
          "room=room-launch&priority=urgent&assignment=mine&execution=running&archived=true",
        ),
      ),
    ).toEqual({
      archived: true,
      assignment: "mine",
      execution: "running",
      priority: "urgent",
      room: "room-launch",
    });

    expect(
      createWorkItemDashboardFilters(
        new URLSearchParams(
          "room=%20%20&priority=critical&assignment=someone&execution=busy&archived=1&creator=missing&assignee=missing",
        ),
      ),
    ).toEqual(EMPTY_WORK_ITEM_DASHBOARD_FILTERS);
  });

  it("writes only non-default filters in one stable order", () => {
    expect(
      workItemDashboardFiltersSearch({
        archived: true,
        assignment: "unassigned",
        execution: "failed",
        priority: "low",
        room: "room-launch",
      }),
    ).toBe(
      "room=room-launch&priority=low&assignment=unassigned&execution=failed&archived=true",
    );
    expect(
      workItemDashboardFiltersSearch(EMPTY_WORK_ITEM_DASHBOARD_FILTERS),
    ).toBe("");
    expect(hasWorkItemDashboardFilters(EMPTY_WORK_ITEM_DASHBOARD_FILTERS)).toBe(
      false,
    );
    expect(
      hasWorkItemDashboardFilters({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        archived: true,
      }),
    ).toBe(true);
  });

  it("round-trips the filters through a URL", () => {
    const filters = {
      archived: true,
      assignment: "mine" as const,
      execution: "waiting_for_approval" as const,
      priority: "high" as const,
      room: "room-launch",
    };

    expect(
      createWorkItemDashboardFilters(
        new URLSearchParams(workItemDashboardFiltersSearch(filters)),
      ),
    ).toEqual(filters);
  });

  it("keeps Room out of the list request and its cache key", () => {
    const filters = {
      ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
      room: "room-launch",
    };

    expect(workItemDashboardListQuery(filters)).toEqual({});
    expect(workItemDashboardListFilterSearch(filters)).toBe("");
  });

  it("maps every other filter onto the Work Item list query", () => {
    expect(
      workItemDashboardListQuery(
        {
          archived: true,
          assignment: "mine",
          execution: "running",
          priority: "high",
          room: "",
        },
        "actor-jenny",
      ),
    ).toEqual({
      archived: true,
      assignee_actor_id: "actor-jenny",
      execution_status: "running",
      priority: "high",
    });
  });

  it("requests no assignee for All or Unassigned", () => {
    expect(
      workItemDashboardListQuery(
        { ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS, assignment: "all" },
        "actor-jenny",
      ),
    ).toEqual({});
    expect(
      workItemDashboardListQuery(
        { ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS, assignment: "unassigned" },
        "actor-jenny",
      ),
    ).toEqual({});
  });

  it("resolves Mine to the active Tenant's Human Actor", () => {
    const identity = {
      actors: [
        { id: "actor-other", tenant_id: "tenant-b" },
        { id: "actor-jenny", tenant_id: "tenant-a" },
      ],
    };

    expect(currentDashboardActorId(identity, "tenant-a")).toBe("actor-jenny");
    expect(currentDashboardActorId(identity, "tenant-missing")).toBeUndefined();
  });
});
