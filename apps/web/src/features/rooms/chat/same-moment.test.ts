import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { sameMomentStarts } from "./same-moment";

function message(
  id: string,
  authorId: string,
  createdAt: string,
  kind: TeamHubMessage["message_kind"] = "conversation",
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: authorId,
      id: authorId,
      kind: "human",
      tenant_id: "tenant",
    },
    created_at: createdAt,
    id,
    message_kind: kind,
    raw_message: id,
    room_id: "room",
    segments: [{ content: id, type: "text" }],
    tenant_id: "tenant",
  };
}

describe("sameMomentStarts", () => {
  it("pairs two people who spoke within the same breath", () => {
    const messages = [
      message("a", "alice", "2026-10-22T10:00:00.000Z"),
      message("b", "bob", "2026-10-22T10:00:02.000Z"),
      message("c", "cara", "2026-10-22T10:00:09.000Z"),
    ];
    expect(sameMomentStarts(messages)).toEqual([0]);
  });

  it("leaves one person's own follow-up, a notice, and a later reply alone", () => {
    const messages = [
      message("a", "alice", "2026-10-22T10:00:00.000Z"),
      message("a2", "alice", "2026-10-22T10:00:01.000Z"),
      message("note", "room", "2026-10-22T10:00:01.500Z", "room_notice"),
      message("b", "bob", "2026-10-22T10:00:02.000Z"),
      message("c", "cara", "2026-10-22T10:00:06.000Z"),
    ];
    expect(sameMomentStarts(messages)).toEqual([]);
  });

  it("pairs the first two of three voices and leaves the third for later", () => {
    const messages = [
      message("a", "alice", "2026-10-22T10:00:00.000Z"),
      message("b", "bob", "2026-10-22T10:00:01.000Z"),
      message("c", "cara", "2026-10-22T10:00:02.000Z"),
    ];
    expect(sameMomentStarts(messages)).toEqual([0]);
  });

  it("skips pairs that touch excluded indices", () => {
    const messages = [
      message("a", "alice", "2026-10-22T10:00:00.000Z"),
      message("b", "bob", "2026-10-22T10:00:02.000Z"),
      message("c", "cara", "2026-10-22T10:00:05.000Z"),
    ];
    expect(sameMomentStarts(messages, new Set([1, 2]))).toEqual([]);
  });
});
