import { describe, expect, it } from "vitest";

import type {
  TeamHubMemoryEntry,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";

import { buildJumpPlaces, filterJumpPlaces } from "./jump-places";

function room(
  id: string,
  name: string,
  kind: TeamHubRoomListItem["kind"] = "room",
): TeamHubRoomListItem {
  return {
    created_at: "2026-11-01T00:00:00Z",
    created_by: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    id,
    kind,
    latest_room_seq: 1,
    name,
    read_through_room_seq: 1,
    tenant_id: "tenant-northstar",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-11-01T00:00:00Z",
    ...(kind === "direct"
      ? {
          direct_peer: {
            display_name: "Codex",
            id: "actor-codex",
            kind: "agent" as const,
            tenant_id: "tenant-northstar",
          },
        }
      : {}),
  };
}

function meeting(id: string, path: string): TeamHubMemoryEntry {
  return {
    content: "",
    id,
    kind: "meeting",
    meeting: {
      capture_id: `capture-${id}`,
      recording_document_id: "audio",
      recording_filename: "launch.m4a",
      recording_version_id: "audio-v1",
      started_at: "2026-11-12T09:00:00Z",
      summary_ready: true,
      transcript_document_id: "transcript",
      transcript_version_id: "transcript-v1",
    },
    path,
    summary: "",
    title: path,
    updated_at: "2026-11-12T09:00:00Z",
  };
}

describe("jump places", () => {
  const places = buildJumpPlaces({
    anotherMeRoomId: "room-another-me",
    meetings: [
      meeting("meeting-early", "Meetings/2026/11/10/Meeting 09-00-00"),
      meeting("meeting-late", "Meetings/2026/11/12/Meeting 15-30-00"),
    ],
    rooms: [
      room("room-thread", "A thread", "thread"),
      room("room-codex", "Chat", "direct"),
      room("room-another-me", "Chat", "direct"),
      room("room-product", "product-v0"),
    ],
    tenantId: "tenant northstar",
  });

  it("lists places you can open and leaves threads out", () => {
    expect(places.map((place) => place.title)).toEqual([
      "Another Me",
      "Codex",
      "product-v0",
      "Nov 12, 15:30",
      "Nov 10, 09:00",
      "Library",
      "Meetings",
      "Wiki",
      "Projects",
      "Topics",
      "People",
      "Companies",
      "Connectors",
      "Messages",
    ]);
    expect(places.some((place) => place.title === "A thread")).toBe(false);
    expect(places.find((place) => place.title === "Library")?.path).toBe(
      "/t/tenant%20northstar/library",
    );
    expect(
      places.find((place) => place.title === "Nov 12, 15:30")?.detail,
    ).toBe("launch.m4a");
  });

  it("narrows by the words in the title or the detail", () => {
    expect(
      filterJumpPlaces(places, "launch").map((place) => place.title),
    ).toEqual(["Nov 12, 15:30", "Nov 10, 09:00"]);
    expect(
      filterJumpPlaces(places, "  PEOPLE ").map((place) => place.title),
    ).toEqual(["People"]);
    expect(filterJumpPlaces(places, "no such place")).toEqual([]);
  });
});
