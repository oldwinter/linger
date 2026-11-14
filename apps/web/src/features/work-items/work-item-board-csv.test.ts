import { describe, expect, it } from "vitest";

import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import {
  workItemBoardCsv,
  workItemBoardCsvFilename,
} from "./work-item-board-csv";

const ORIGIN = "https://app.example";

describe("Work Item board CSV", () => {
  it("writes the fixed header and one escaped row per card in column order", () => {
    const csv = workItemBoardCsv({
      origin: ORIGIN,
      roomLabel: sourceRoomLabel,
      sections: [
        {
          items: [
            item({
              assignees: [assignment("Jenny"), assignment("Codex")],
              id: "workitem-login",
              origin_room_id: "room-all",
              priority: "urgent",
              title: 'Fix, "login"\nnow',
              updated_at: "2026-07-30T10:00:00Z",
            }),
          ],
          label: "Todo",
        },
        {
          items: [item({ id: "workitem-move", title: "Move the board" })],
          label: "In progress",
        },
      ],
      tenantId: "tenant-northstar",
    });

    expect(csv).toBe(
      [
        "Title,Status,Priority,Assignees,Source Room,Updated,URL",
        // The line break stays inside its quoted cell, as RFC 4180 requires.
        '"Fix, ""login""',
        `now",Todo,Urgent,"Jenny, Codex",#all,2026-07-30T10:00:00Z,${ORIGIN}/t/tenant-northstar/dashboard/workitem-login`,
        `Move the board,In progress,High,,No source room,2026-07-30T00:00:00Z,${ORIGIN}/t/tenant-northstar/dashboard/workitem-move`,
        "",
      ].join("\n"),
    );
  });

  it("quotes a carriage return and leaves plain values unquoted", () => {
    expect(
      workItemBoardCsv({
        origin: ORIGIN,
        roomLabel: sourceRoomLabel,
        sections: [
          {
            items: [
              item({ origin_room_id: "room-gone", title: "First\rSecond" }),
            ],
            label: "Done",
          },
        ],
        tenantId: "tenant-northstar",
      }),
    ).toBe(
      [
        "Title,Status,Priority,Assignees,Source Room,Updated,URL",
        `"First\rSecond",Done,High,,Unknown room (room-gone),2026-07-30T00:00:00Z,${ORIGIN}/t/tenant-northstar/dashboard/workitem-login`,
        "",
      ].join("\n"),
    );
  });

  it("writes only the header for an empty board", () => {
    expect(
      workItemBoardCsv({
        origin: ORIGIN,
        roomLabel: sourceRoomLabel,
        sections: [
          { items: [], label: "Todo" },
          { items: [], label: "Closed" },
        ],
        tenantId: "tenant-northstar",
      }),
    ).toBe("Title,Status,Priority,Assignees,Source Room,Updated,URL\n");
  });

  it("names the file for the board and the day it is saved", () => {
    expect(workItemBoardCsvFilename(new Date(2026, 6, 30, 12))).toBe(
      "work-items-2026-07-30.csv",
    );
  });
});

function sourceRoomLabel(item: TeamHubWorkItem) {
  if (!item.origin_room_id) return "No source room";
  return item.origin_room_id === "room-all"
    ? "#all"
    : `Unknown room (${item.origin_room_id})`;
}

function item(override: Partial<TeamHubWorkItem> = {}): TeamHubWorkItem {
  const actor = human("Jenny");
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "Email login returns 500.",
    explicit_access_grants: [],
    id: "workitem-login",
    kind: "issue",
    number: 42,
    priority: "high",
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

function assignment(displayName: string): TeamHubWorkItem["assignees"][number] {
  const actor = human(displayName);
  return {
    actor,
    assigned_at: "2026-07-30T00:00:00Z",
    assigned_by: actor,
  };
}

function human(displayName: string) {
  return {
    display_name: displayName,
    id: `actor-${displayName.toLowerCase()}`,
    kind: "human" as const,
    tenant_id: "tenant-northstar",
  };
}
