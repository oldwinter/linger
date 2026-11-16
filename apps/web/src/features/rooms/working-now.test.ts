import { describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  trackRunsYouStarted,
  workingNowRooms,
  workingPhaseLabel,
} from "./working-now";

function room(
  id: string,
  overrides: Partial<TeamHubRoomListItem> = {},
): TeamHubRoomListItem {
  return {
    created_at: "2026-07-24T09:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-a",
    },
    id,
    kind: "room",
    latest_room_seq: 1,
    name: id,
    read_through_room_seq: 1,
    tenant_id: "tenant-a",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-07-24T10:00:00Z",
    ...overrides,
  };
}

describe("working now", () => {
  it("keeps running rooms and follows the latest author's kind", () => {
    const rooms = workingNowRooms(
      [
        room("room-idle"),
        room("room-codex", {
          direct_peer: {
            display_name: "Codex",
            id: "actor-codex",
            kind: "agent",
            tenant_id: "tenant-a",
          },
          kind: "direct",
          latest_message: {
            author: {
              display_name: "Jenny",
              id: "actor-jenny",
              kind: "human",
              tenant_id: "tenant-a",
            },
            created_at: "2026-07-24T10:00:00Z",
            id: "message-1",
            raw_message: "**Ship** the brief",
            room_seq: 2,
          },
          name: "Codex",
        }),
        room("room-thread", { kind: "thread", name: "A thread" }),
        room("room-me", {
          latest_message: {
            author: {
              display_name: "Another Me",
              id: "actor-me",
              kind: "agent",
              tenant_id: "tenant-a",
            },
            created_at: "2026-07-24T10:05:00Z",
            id: "message-2",
            raw_message: "On it.",
            room_seq: 3,
          },
          name: "Another Me",
        }),
      ],
      ["room-codex", "room-thread", "room-me"],
    );
    expect(rooms).toEqual([
      {
        id: "room-codex",
        name: "Codex",
        phase: "on-your-message",
        preview: "Ship the brief",
      },
      {
        id: "room-me",
        name: "Another Me",
        phase: "replying",
        preview: "On it.",
      },
    ]);
    expect(workingPhaseLabel("on-your-message")).toBe("On your message");
    expect(workingPhaseLabel("replying")).toBe("Replying");
  });
});

describe("trackRunsYouStarted", () => {
  const yours = {
    author: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human" as const,
      tenant_id: "tenant-a",
    },
    created_at: "2026-07-24T10:00:00Z",
    id: "message-1",
    raw_message: "Ship the brief",
    room_seq: 2,
  };
  const reply = {
    author: {
      display_name: "Codex",
      id: "actor-codex",
      kind: "agent" as const,
      tenant_id: "tenant-a",
    },
    created_at: "2026-07-24T10:05:00Z",
    id: "message-2",
    raw_message: "The brief is shipped.",
    room_seq: 3,
  };

  it("keeps the reply when a run you started finishes in another room", () => {
    const running = trackRunsYouStarted({
      activeRoomId: "room-here",
      actorId: "actor-jenny",
      failedRoomIds: [],
      finished: [],
      rooms: [
        room("room-codex", {
          latest_message: yours,
          name: "Codex",
        }),
      ],
      runningRoomIds: ["room-codex"],
      started: [],
    });
    expect(running.started).toEqual([
      { messageId: "message-1", roomId: "room-codex" },
    ]);
    const done = trackRunsYouStarted({
      activeRoomId: "room-here",
      actorId: "actor-jenny",
      failedRoomIds: [],
      finished: running.finished,
      rooms: [
        room("room-codex", {
          latest_message: reply,
          name: "Codex",
        }),
      ],
      runningRoomIds: [],
      started: running.started,
    });
    expect(done.started).toEqual([]);
    expect(done.finished).toEqual([
      {
        messageId: "message-2",
        name: "Codex",
        reply: "The brief is shipped.",
        roomId: "room-codex",
      },
    ]);
    expect(
      trackRunsYouStarted({
        activeRoomId: "room-codex",
        actorId: "actor-jenny",
        failedRoomIds: [],
        finished: done.finished,
        rooms: [room("room-codex", { latest_message: reply, name: "Codex" })],
        runningRoomIds: [],
        started: [],
      }).finished,
    ).toEqual([]);
  });

  it("leaves the reply out when you are in that room, it failed, or it is Another Me", () => {
    const started = [{ messageId: "message-1", roomId: "room-codex" }];
    const rooms = [
      room("room-codex", { latest_message: reply, name: "Codex" }),
    ];
    expect(
      trackRunsYouStarted({
        activeRoomId: "room-codex",
        actorId: "actor-jenny",
        failedRoomIds: [],
        finished: [],
        rooms,
        runningRoomIds: [],
        started,
      }).finished,
    ).toEqual([]);
    expect(
      trackRunsYouStarted({
        activeRoomId: "room-here",
        actorId: "actor-jenny",
        failedRoomIds: ["room-codex"],
        finished: [],
        rooms,
        runningRoomIds: [],
        started,
      }).finished,
    ).toEqual([]);
    expect(
      trackRunsYouStarted({
        activeRoomId: "room-here",
        actorId: "actor-jenny",
        anotherMeRoomId: "room-codex",
        failedRoomIds: [],
        finished: [],
        rooms,
        runningRoomIds: [],
        started,
      }).finished,
    ).toEqual([]);
  });
});
