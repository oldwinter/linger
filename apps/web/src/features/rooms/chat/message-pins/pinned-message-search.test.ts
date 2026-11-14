import { describe, expect, it } from "vitest";

import type { TeamHubMessagePinList } from "@/features/teamhub/teamhub-types";

import { searchPinnedMessages } from "./pinned-message-search";

type MessagePin = TeamHubMessagePinList["items"][number];

function pin(id: string, rawMessage: string, authorName = "Alice"): MessagePin {
  return {
    message: {
      attachments: [],
      author: {
        display_name: authorName,
        id: `actor-${authorName.toLowerCase()}`,
        kind: "human",
        tenant_id: "tenant-1",
      },
      created_at: "2026-10-09T08:00:00.000Z",
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

const release = pin("message-1", "Freeze the release");
const ship = pin("message-2", "Ship it", "Bob");
const roadmap = pin("message-3", "Q4 roadmap review", "Alice");
const pins = [release, ship, roadmap];

function ids(items: readonly MessagePin[]) {
  return items.map((item) => item.message.id);
}

describe("searchPinnedMessages", () => {
  it("matches a Message's text", () => {
    expect(ids(searchPinnedMessages(pins, "ship").items)).toEqual([
      "message-2",
    ]);
  });

  it("matches an author's name", () => {
    expect(ids(searchPinnedMessages(pins, "bob").items)).toEqual(["message-2"]);
    expect(searchPinnedMessages(pins, "bob").count).toBe(1);
  });

  it("matches case-insensitively", () => {
    expect(ids(searchPinnedMessages(pins, "SHIP").items)).toEqual([
      "message-2",
    ]);
  });

  it("requires every word, anywhere across the text and the author", () => {
    // One word from the author and one from the text.
    expect(ids(searchPinnedMessages(pins, "alice roadmap").items)).toEqual([
      "message-3",
    ]);
    expect(ids(searchPinnedMessages(pins, "alice freeze").items)).toEqual([
      "message-1",
    ]);
    expect(searchPinnedMessages(pins, "alice ship").items).toEqual([]);
  });

  it("keeps the existing order of the matches", () => {
    expect(ids(searchPinnedMessages(pins, "e").items)).toEqual([
      "message-1",
      "message-3",
    ]);
  });

  it("keeps every pin and counts them for an empty query", () => {
    const result = searchPinnedMessages(pins, "");

    expect(ids(result.items)).toEqual(["message-1", "message-2", "message-3"]);
    expect(result.count).toBe(3);
    expect(result.items[0]).toBe(pins[0]);
  });

  it("treats a whitespace-only query as empty", () => {
    expect(searchPinnedMessages(pins, "   ").count).toBe(3);
  });

  it("counts no pins when nothing matches", () => {
    const result = searchPinnedMessages(pins, "absent phrase");

    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
  });
});
