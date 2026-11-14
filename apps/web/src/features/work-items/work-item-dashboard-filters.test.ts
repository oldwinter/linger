import { describe, expect, it } from "vitest";

import {
  clearWorkItemDashboardFilters,
  createWorkItemDashboardFilters,
  currentDashboardActorId,
  EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
  hasWorkItemDashboardFilters,
  hasWorkItemDashboardNarrowingFilters,
  matchesWorkItemText,
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
      text: "",
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
        text: "",
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

  it("clears every filter but the Room scope", () => {
    const filters = {
      archived: true,
      assignment: "mine" as const,
      execution: "running" as const,
      priority: "high" as const,
      room: "room-launch",
      text: "plan release",
    };

    expect(clearWorkItemDashboardFilters(filters)).toEqual({
      ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
      room: "room-launch",
    });
    expect(hasWorkItemDashboardNarrowingFilters(filters)).toBe(true);
    expect(
      hasWorkItemDashboardNarrowingFilters({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        room: "room-launch",
      }),
    ).toBe(false);
    expect(
      hasWorkItemDashboardNarrowingFilters(EMPTY_WORK_ITEM_DASHBOARD_FILTERS),
    ).toBe(false);
    expect(
      hasWorkItemDashboardNarrowingFilters({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        text: "  ",
      }),
    ).toBe(false);
  });

  it("round-trips the filters through a URL", () => {
    const filters = {
      archived: true,
      assignment: "mine" as const,
      execution: "waiting_for_approval" as const,
      priority: "high" as const,
      room: "room-launch",
      text: "plan release",
    };

    expect(
      createWorkItemDashboardFilters(
        new URLSearchParams(workItemDashboardFiltersSearch(filters)),
      ),
    ).toEqual(filters);
  });

  it("keeps Room and the title query out of the list request and its cache key", () => {
    const filters = {
      ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
      room: "room-launch",
      text: "plan release",
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
          text: "",
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

  it("reads the title query from the URL, treating blank as absent", () => {
    expect(createWorkItemDashboardFilters(new URLSearchParams()).text).toBe("");
    expect(
      createWorkItemDashboardFilters(new URLSearchParams("q=%20%20")).text,
    ).toBe("");
    expect(
      createWorkItemDashboardFilters(new URLSearchParams("q=release")).text,
    ).toBe("release");
    expect(
      createWorkItemDashboardFilters(new URLSearchParams("q=++plan++release++"))
        .text,
    ).toBe("  plan  release  ");
  });

  it("writes the title query only when it has text", () => {
    expect(
      workItemDashboardFiltersSearch({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        text: "plan release",
      }),
    ).toBe("q=plan+release");
    expect(
      workItemDashboardFiltersSearch({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        text: "   ",
      }),
    ).toBe("");
    expect(
      hasWorkItemDashboardFilters({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        text: "plan",
      }),
    ).toBe(true);
    expect(
      hasWorkItemDashboardFilters({
        ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
        text: "  ",
      }),
    ).toBe(false);
  });

  it("round-trips a title query that still has a word to type", () => {
    const filters = {
      ...EMPTY_WORK_ITEM_DASHBOARD_FILTERS,
      text: "  plan   release ",
    };

    expect(
      createWorkItemDashboardFilters(
        new URLSearchParams(workItemDashboardFiltersSearch(filters)),
      ),
    ).toEqual(filters);
  });

  it("matches every query word against the title alone", () => {
    const item = { title: "Plan the Q4 release" };

    expect(matchesWorkItemText(item, "release plan")).toBe(true);
    expect(matchesWorkItemText(item, "PLAN")).toBe(true);
    expect(matchesWorkItemText(item, "  plan   q4  ")).toBe(true);
    expect(matchesWorkItemText(item, "plan budget")).toBe(false);
    expect(matchesWorkItemText(item, "???")).toBe(false);
    expect(matchesWorkItemText(item, "")).toBe(true);
    expect(matchesWorkItemText(item, "   ")).toBe(true);
    expect(matchesWorkItemText({ title: "Fix login failure" }, "release")).toBe(
      false,
    );
  });
});
