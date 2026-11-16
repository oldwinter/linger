import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { leadingYesterdayQuestion } from "./yesterday-question";

const now = new Date(2026, 10, 16, 8, 45);
const selfId = "human-jenny";

function message(
  id: string,
  text: string,
  createdAt: Date,
  authorId = selfId,
  replyTo?: string,
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: authorId,
      id: authorId,
      kind: authorId === selfId ? "human" : "agent",
      tenant_id: "tenant-1",
    },
    created_at: createdAt.toISOString(),
    id,
    message_kind: "conversation",
    raw_message: text,
    room_id: "room-1",
    segments: [{ type: "text", content: text }],
    tenant_id: "tenant-1",
    ...(replyTo ? { reply_to_message_id: replyTo } : {}),
  };
}

const yesterday = new Date(2026, 10, 15, 16, 0);

describe("leadingYesterdayQuestion", () => {
  it("leads with the latest question from yesterday that is still open", () => {
    expect(
      leadingYesterdayQuestion(
        [
          message("older", "First?", new Date(2026, 10, 15, 9, 0)),
          message("latest", "Still open?", yesterday),
          message(
            "chatter",
            "Something else",
            new Date(2026, 10, 16, 8, 0),
            "agent-1",
          ),
        ],
        selfId,
        now,
      ),
    ).toBe("latest");
  });

  it("stops leading once you speak again or someone answers it", () => {
    const asked = message("asked", "Can you send it?", yesterday);
    expect(
      leadingYesterdayQuestion(
        [asked, message("again", "Never mind", new Date(2026, 10, 16, 8, 0))],
        selfId,
        now,
      ),
    ).toBeUndefined();
    expect(
      leadingYesterdayQuestion(
        [
          asked,
          message(
            "reply",
            "Sent",
            new Date(2026, 10, 16, 8, 0),
            "agent-1",
            "asked",
          ),
        ],
        selfId,
        now,
      ),
    ).toBeUndefined();
  });

  it("ignores a question from today or a statement from yesterday", () => {
    expect(
      leadingYesterdayQuestion(
        [
          message("today", "Now?", new Date(2026, 10, 16, 7, 0)),
          message("statement", "I shipped it.", yesterday),
        ],
        selfId,
        now,
      ),
    ).toBeUndefined();
  });
});
