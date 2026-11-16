import { describe, expect, it } from "vitest";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { leadUnmetPromises } from "./work-item-unmet-promise";

const jenny = {
  display_name: "Jenny",
  id: "actor-jenny",
  kind: "human" as const,
  tenant_id: "tenant-northstar",
};
const now = new Date(2026, 10, 16, 8, 20);
const yesterdayAt = new Date(2026, 10, 15, 8, 0).toISOString();
const olderAt = new Date(2026, 10, 14, 8, 0).toISOString();
const todayAt = new Date(2026, 10, 16, 1, 0).toISOString();

function item(
  overrides: Partial<TeamHubWorkItem> & Pick<TeamHubWorkItem, "id" | "title">,
): TeamHubWorkItem {
  return {
    assignees: [
      {
        actor: jenny,
        assigned_at: "2026-11-15T08:00:00.000Z",
        assigned_by: jenny,
      },
    ],
    created_at: yesterdayAt,
    created_by: jenny,
    description: "",
    explicit_access_grants: [],
    kind: "issue",
    number: 1,
    priority: "medium",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    updated_at: "2026-11-15T08:00:00.000Z",
    updated_by: jenny,
    version: 1,
    ...overrides,
  };
}

describe("leadUnmetPromises", () => {
  it("leads with the promise whose day ended, oldest first", () => {
    const older = item({
      created_at: olderAt,
      id: "older",
      title: "Send the deck",
    });
    const yesterday = item({ id: "yesterday", title: "Book the room" });
    const today = item({
      created_at: todayAt,
      id: "today",
      title: "Still today",
    });
    const theirs = item({
      assignees: [
        {
          actor: {
            display_name: "Mina",
            id: "actor-mina",
            kind: "human",
            tenant_id: "tenant-northstar",
          },
          assigned_at: "2026-11-15T08:00:00.000Z",
          assigned_by: jenny,
        },
      ],
      id: "theirs",
      title: "Mina's task",
    });
    const doing = item({
      id: "doing",
      state: "in_progress",
      title: "Already started",
    });
    expect(
      leadUnmetPromises(
        [today, theirs, yesterday, doing, older],
        jenny.id,
        now,
      ).map((entry) => entry.id),
    ).toEqual(["older", "yesterday", "today", "theirs", "doing"]);
  });

  it("leaves today's own open item where it was", () => {
    const today = item({
      created_at: todayAt,
      id: "today",
      title: "Still today",
    });
    expect(
      leadUnmetPromises([today], jenny.id, now).map((entry) => entry.id),
    ).toEqual(["today"]);
  });
});
