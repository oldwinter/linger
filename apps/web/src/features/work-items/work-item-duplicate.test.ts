import { describe, expect, it } from "vitest";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { WORK_ITEM_TITLE_LIMIT } from "./work-item-create-draft";
import { workItemDuplicateDraft } from "./work-item-duplicate";

describe("workItemDuplicateDraft", () => {
  it("prefixes the title and copies the description and priority", () => {
    expect(
      workItemDuplicateDraft(
        workItem({
          description: "Email login returns 500.",
          priority: "high",
          title: "Fix login failure",
        }),
      ),
    ).toEqual({
      description: "Email login returns 500.",
      originRoomId: "",
      priority: "high",
      title: "Copy of Fix login failure",
    });
  });

  it("keeps an Item without a description empty", () => {
    expect(
      workItemDuplicateDraft(
        workItem({ description: "", title: "Ship export" }),
      ),
    ).toEqual({
      description: "",
      originRoomId: "",
      priority: "medium",
      title: "Copy of Ship export",
    });
  });

  it("keeps the prefixed title within the create dialog's limit", () => {
    const draft = workItemDuplicateDraft(
      workItem({ title: "t".repeat(WORK_ITEM_TITLE_LIMIT) }),
    );

    expect(draft.title).toHaveLength(WORK_ITEM_TITLE_LIMIT);
    expect(draft.title.startsWith("Copy of ")).toBe(true);
  });
});

function workItem(override: Partial<TeamHubWorkItem> = {}): TeamHubWorkItem {
  const actor: TeamHubWorkItem["created_by"] = {
    display_name: "Jenny Bin",
    id: "actor-jenny",
    kind: "human",
    tenant_id: "tenant-northstar",
  };
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "",
    explicit_access_grants: [],
    id: "workitem-login",
    kind: "issue",
    number: 42,
    priority: "medium",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: "Fix login failure",
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
}
