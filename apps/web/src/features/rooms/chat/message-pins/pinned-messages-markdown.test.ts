import { describe, expect, it } from "vitest";

import type { TeamHubMessagePinList } from "@/features/teamhub/teamhub-types";

import { pinnedMessagesMarkdown } from "./pinned-messages-markdown";

type MessagePin = TeamHubMessagePinList["items"][number];

const origin = "https://rooms.example.com";

function pin(
  id: string,
  rawMessage: string,
  authorName = "Alice",
  createdAt = "2026-10-09T10:00:00",
): MessagePin {
  return {
    message: {
      attachments: [],
      author: {
        display_name: authorName,
        id: `actor-${authorName.toLowerCase()}`,
        kind: "human",
        tenant_id: "tenant-1",
      },
      created_at: createdAt,
      id,
      message_kind: "conversation",
      raw_message: rawMessage,
      room_id: "room-1",
      segments: [{ content: rawMessage, type: "text" }],
      tenant_id: "tenant-1",
    },
    pinned_at: "2026-10-10T08:00:00.000Z",
    pinned_by_actor_id: "human-1",
  };
}

function document(pins: readonly MessagePin[], roomName = "Design") {
  return pinnedMessagesMarkdown({
    origin,
    pins,
    roomName,
    tenantId: "tenant-1",
  });
}

describe("pinnedMessagesMarkdown", () => {
  it("writes one pin as a heading, its author and time, its body, and a link", () => {
    expect(document([pin("message-1", "Freeze the release")])).toBe(
      [
        "# Pinned messages in Design",
        "",
        "**Alice, 2026-10-09 10:00**",
        "Freeze the release",
        "https://rooms.example.com/t/tenant-1/rooms/room-1/chat?message=message-1",
      ].join("\n"),
    );
  });

  it("keeps the displayed order and separates the pins", () => {
    expect(
      document([
        pin("message-2", "Ship it", "Bob", "2026-10-10T11:30:00"),
        pin("message-1", "Freeze the release"),
      ]),
    ).toBe(
      [
        "# Pinned messages in Design",
        "",
        "**Bob, 2026-10-10 11:30**",
        "Ship it",
        "https://rooms.example.com/t/tenant-1/rooms/room-1/chat?message=message-2",
        "",
        "**Alice, 2026-10-09 10:00**",
        "Freeze the release",
        "https://rooms.example.com/t/tenant-1/rooms/room-1/chat?message=message-1",
      ].join("\n"),
    );
  });

  it("keeps the author line and link for a pin with no readable body", () => {
    expect(document([pin("message-1", "")])).toBe(
      [
        "# Pinned messages in Design",
        "",
        "**Alice, 2026-10-09 10:00**",
        "https://rooms.example.com/t/tenant-1/rooms/room-1/chat?message=message-1",
      ].join("\n"),
    );
  });

  it("writes the readable body rather than the Message's Markdown", () => {
    expect(document([pin("message-1", "## Plan\n\n**Ship** it")])).toContain(
      "**Alice, 2026-10-09 10:00**\nPlan\n\nShip it\nhttps://rooms.example.com/t/tenant-1/rooms/room-1/chat?message=message-1",
    );
  });

  it("names the Room in the heading", () => {
    expect(
      document([pin("message-1", "Freeze the release")], "Release"),
    ).toMatch(/^# Pinned messages in Release\n/u);
  });

  it("writes nothing when no pin is listed", () => {
    expect(document([])).toBe("");
  });
});
