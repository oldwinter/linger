import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { pairedAgentAnswers } from "./paired-agent-answers";

function answer(
  id: string,
  authorId: string,
  parentId: string | undefined,
  createdAt: string,
  kind: "agent" | "human" = "agent",
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: authorId,
      id: authorId,
      kind,
      tenant_id: "tenant-1",
    },
    created_at: createdAt,
    id,
    message_kind: "conversation",
    raw_message: id,
    room_id: "room-1",
    segments: [{ type: "text", content: id }],
    tenant_id: "tenant-1",
    ...(parentId ? { reply_to_message_id: parentId } : {}),
  };
}

describe("pairedAgentAnswers", () => {
  it("pairs different agents who answer the same message, however far apart", () => {
    expect(
      pairedAgentAnswers([
        answer(
          "ask",
          "human-1",
          undefined,
          "2026-11-16T08:00:00.000Z",
          "human",
        ),
        answer("codex", "agent-codex", "ask", "2026-11-16T08:01:00.000Z"),
        answer("lev", "agent-lev", "ask", "2026-11-16T08:40:00.000Z"),
      ]),
    ).toEqual([{ end: 2, parentId: "ask", start: 1 }]);
  });

  it("leaves agents apart when they answer different messages or one speaks twice", () => {
    expect(
      pairedAgentAnswers([
        answer("codex", "agent-codex", "ask", "2026-11-16T08:00:00.000Z"),
        answer("lev", "agent-lev", "other", "2026-11-16T08:00:02.000Z"),
        answer("codex-again", "agent-codex", "ask", "2026-11-16T08:00:03.000Z"),
        answer("codex-more", "agent-codex", "ask", "2026-11-16T08:00:04.000Z"),
      ]),
    ).toEqual([]);
  });
});
