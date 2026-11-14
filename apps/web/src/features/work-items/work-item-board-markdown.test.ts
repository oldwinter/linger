import { describe, expect, it } from "vitest";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { workItemBoardMarkdown } from "./work-item-board-markdown";

const origin = "https://app.example";

function workItem(override: Partial<TeamHubWorkItem>): TeamHubWorkItem {
  const actor = author();
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "",
    explicit_access_grants: [],
    id: "workitem-todo",
    kind: "issue",
    number: 1,
    priority: "medium",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: "Untitled",
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
}

function author(): TeamHubWorkItem["created_by"] {
  return {
    display_name: "Jenny Bin",
    id: "human-jenny",
    kind: "human",
    tenant_id: "tenant-northstar",
  };
}

function assignedTo(name: string) {
  return [
    {
      actor: {
        display_name: name,
        id: `actor-${name}`,
        kind: "agent" as const,
        tenant_id: "tenant-northstar",
      },
      assigned_at: "2026-07-30T00:00:00Z",
      assigned_by: author(),
    },
  ];
}

describe("workItemBoardMarkdown", () => {
  it("writes the columns and cards in board order with absolute links", () => {
    const todo = workItem({
      assignees: assignedTo("Codex"),
      id: "workitem-login",
      priority: "high",
      title: "Fix login failure",
    });
    const notifications = workItem({
      id: "workitem-notifications",
      priority: "low",
      title: "Quiet notifications",
    });
    const done = workItem({
      id: "workitem-export",
      resolution: "completed",
      state: "resolved",
      title: "Ship export",
    });

    expect(
      workItemBoardMarkdown({
        filters: ["Room #GTM launch", "Priority High"],
        origin,
        sections: [
          { items: [todo, notifications], label: "Todo" },
          { items: [], label: "In progress" },
          { items: [done], label: "Done" },
          { items: [], label: "Closed" },
        ],
        sortLabel: "Recently updated",
        tenantId: "tenant-northstar",
      }),
    ).toBe(
      [
        "# Work Items",
        "",
        "Room #GTM launch · Priority High · Sort Recently updated",
        "",
        "## Todo",
        "- [Fix login failure](https://app.example/t/tenant-northstar/dashboard/workitem-login) · High priority · Assigned to Codex",
        "- [Quiet notifications](https://app.example/t/tenant-northstar/dashboard/workitem-notifications) · Low priority",
        "",
        "## Done",
        "- [Ship export](https://app.example/t/tenant-northstar/dashboard/workitem-export) · Medium priority",
        "",
      ].join("\n"),
    );
  });

  it("omits columns with no cards", () => {
    const markdown = workItemBoardMarkdown({
      filters: [],
      origin,
      sections: [
        { items: [], label: "Todo" },
        { items: [workItem({ title: "Plan release" })], label: "In progress" },
        { items: [], label: "Done" },
      ],
      sortLabel: "Newest first",
      tenantId: "tenant-northstar",
    });

    expect(markdown).not.toContain("## Todo");
    expect(markdown).not.toContain("## Done");
    expect(markdown).toContain("## In progress");
  });

  it("leaves the assignee out when nobody is assigned", () => {
    const markdown = workItemBoardMarkdown({
      filters: [],
      origin,
      sections: [
        { items: [workItem({ title: "Plan release" })], label: "Todo" },
      ],
      sortLabel: "Recently updated",
      tenantId: "tenant-northstar",
    });

    expect(markdown).toContain("· Medium priority\n");
    expect(markdown).not.toContain("Assigned to");
  });

  it("names every active filter and the sort", () => {
    const markdown = workItemBoardMarkdown({
      filters: ["Assignment Mine", "Execution Agent running", "Archived"],
      origin,
      sections: [{ items: [workItem({})], label: "Todo" }],
      sortLabel: "Most urgent",
      tenantId: "tenant-northstar",
    });

    expect(markdown).toContain(
      "Assignment Mine · Execution Agent running · Archived · Sort Most urgent",
    );
  });

  it("still says how the board is sorted when no filter narrows it", () => {
    const markdown = workItemBoardMarkdown({
      filters: [],
      origin,
      sections: [{ items: [workItem({})], label: "Todo" }],
      sortLabel: "Recently updated",
      tenantId: "tenant-northstar",
    });

    expect(markdown).toContain("\n\nSort Recently updated\n\n## Todo\n");
  });

  it("lists every assignee", () => {
    const markdown = workItemBoardMarkdown({
      filters: [],
      origin,
      sections: [
        {
          items: [
            workItem({
              assignees: [...assignedTo("Codex"), ...assignedTo("Another Me")],
            }),
          ],
          label: "Todo",
        },
      ],
      sortLabel: "Recently updated",
      tenantId: "tenant-northstar",
    });

    expect(markdown).toContain("Assigned to Codex, Another Me");
  });
});
