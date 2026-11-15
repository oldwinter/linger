import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import {
  latestUnansweredNaming,
  unansweredNamingWaitMs,
} from "./unanswered-naming";

const selfId = "human-jenny";

function message(
  overrides: Partial<TeamHubMessage> & Pick<TeamHubMessage, "id">,
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Jenny",
      id: selfId,
      kind: "human",
      tenant_id: "tenant-1",
    },
    created_at: "2026-11-16T08:00:00.000Z",
    message_kind: "conversation",
    raw_message: "Can you send the deck?",
    room_id: "room-1",
    segments: [
      {
        type: "reference",
        content: "@Mina",
        target: "human-mina",
        target_type: "user",
      },
      { type: "text", content: " can you send the deck?" },
    ],
    tenant_id: "tenant-1",
    ...overrides,
  };
}

describe("latestUnansweredNaming", () => {
  it("names the one person you asked who has not spoken since", () => {
    const asked = message({ id: "asked" });
    const naming = latestUnansweredNaming(
      [
        message({
          id: "earlier",
          created_at: "2026-11-16T07:00:00.000Z",
          segments: [
            {
              type: "reference",
              content: "@Bo",
              target: "human-bo",
              target_type: "user",
            },
          ],
        }),
        message({
          author: {
            display_name: "Bo",
            id: "human-bo",
            kind: "human",
            tenant_id: "tenant-1",
          },
          created_at: "2026-11-16T07:30:00.000Z",
          id: "bo-answered",
          raw_message: "On it",
          segments: [{ type: "text", content: "On it" }],
        }),
        asked,
      ],
      selfId,
    );
    expect(naming?.actorId).toBe("human-mina");
    expect(naming?.message.id).toBe("asked");
    expect(naming?.dueAt).toBe(
      Date.parse(asked.created_at) + unansweredNamingWaitMs,
    );
  });

  it("lets their later message answer the naming", () => {
    expect(
      latestUnansweredNaming(
        [
          message({ id: "asked" }),
          message({
            author: {
              display_name: "Mina",
              id: "human-mina",
              kind: "human",
              tenant_id: "tenant-1",
            },
            created_at: "2026-11-16T09:00:00.000Z",
            id: "mina-answered",
            raw_message: "Sent",
            segments: [{ type: "text", content: "Sent" }],
          }),
        ],
        selfId,
      ),
    ).toBeUndefined();
  });

  it("leaves a message that names more than one person", () => {
    expect(
      latestUnansweredNaming(
        [
          message({
            id: "both",
            segments: [
              {
                type: "reference",
                content: "@Mina",
                target: "human-mina",
                target_type: "user",
              },
              {
                type: "reference",
                content: "@Bo",
                target: "human-bo",
                target_type: "user",
              },
            ],
          }),
        ],
        selfId,
      ),
    ).toBeUndefined();
  });
});
