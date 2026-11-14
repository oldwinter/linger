// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import {
  describeWorkItemArchiveOutcome,
  retainVisibleWorkItemSelection,
  toggleWorkItemSelection,
} from "./work-item-selection";

describe("toggleWorkItemSelection", () => {
  it("adds a card that was not selected", () => {
    expect([...toggleWorkItemSelection(new Set(), "card-a")]).toEqual([
      "card-a",
    ]);
  });

  it("removes a card that was selected", () => {
    expect([...toggleWorkItemSelection(new Set(["card-a"]), "card-a")]).toEqual(
      [],
    );
  });

  it("leaves the set it was given alone", () => {
    const before = new Set(["card-a"]);

    toggleWorkItemSelection(before, "card-b");

    expect([...before]).toEqual(["card-a"]);
  });
});

describe("retainVisibleWorkItemSelection", () => {
  it("drops a selected card the board no longer shows", () => {
    expect([
      ...retainVisibleWorkItemSelection(new Set(["card-a", "card-b"]), [
        "card-b",
      ]),
    ]).toEqual(["card-b"]);
  });

  it("keeps the same set when every selected card is still shown", () => {
    const selected = new Set(["card-a"]);

    expect(retainVisibleWorkItemSelection(selected, ["card-a", "card-b"])).toBe(
      selected,
    );
  });

  it("keeps the empty selection it was given", () => {
    const selected = new Set<string>();

    expect(retainVisibleWorkItemSelection(selected, ["card-a"])).toBe(selected);
  });
});

describe("describeWorkItemArchiveOutcome", () => {
  it("counts only what TeamHub accepted", () => {
    expect(describeWorkItemArchiveOutcome(3, [])).toEqual({
      failed: false,
      message: "Archived 3 items.",
    });
  });

  it("says one item in the singular", () => {
    expect(describeWorkItemArchiveOutcome(1, [])).toEqual({
      failed: false,
      message: "Archived 1 item.",
    });
  });

  it("names the Items that failed and keeps the count honest", () => {
    expect(
      describeWorkItemArchiveOutcome(2, [
        workItem("workitem-alpha", "Alpha item"),
        workItem("workitem-beta", "Beta item"),
      ]),
    ).toEqual({
      failed: true,
      message: "Archived 2 of 4 items. Failed: Alpha item, Beta item.",
    });
  });

  it("reports a run where every Item failed", () => {
    expect(
      describeWorkItemArchiveOutcome(0, [
        workItem("workitem-alpha", "Alpha item"),
      ]),
    ).toEqual({
      failed: true,
      message: "Archived 0 of 1 item. Failed: Alpha item.",
    });
  });
});

function workItem(id: string, title: string): TeamHubWorkItem {
  const actor = {
    created_at: "2026-07-30T00:00:00Z",
    display_name: "Ada",
    id: "actor-ada",
    kind: "human",
    tenant_id: "tenant-northstar",
  } as const;
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
    title,
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
  };
}
