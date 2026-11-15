import { describe, expect, it, vi } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  describeMarkAllRoomsRead,
  MARK_ALL_ROOMS_READ_CONCURRENCY,
  markAllRoomsRead,
  markAllRoomsReadTargets,
} from "./room-mark-all-read";

describe("markAllRoomsReadTargets", () => {
  it("targets only the Rooms that can advance their cursor, in list order", () => {
    expect(
      markAllRoomsReadTargets([
        unreadRoom("room-a", 12, 9),
        readRoom("room-b", 12, 12),
        { ...unreadRoom("room-c", 12, 9), latest_message: undefined },
        unreadRoom("room-d", 5, 5),
        unreadRoom("room-e", 7, 2),
      ]),
    ).toEqual([
      { roomId: "room-a", throughRoomSeq: 12 },
      { roomId: "room-e", throughRoomSeq: 7 },
    ]);
  });

  it("targets nothing when every Room is already read", () => {
    expect(markAllRoomsReadTargets([readRoom("room-a", 4, 4)])).toEqual([]);
  });
});

describe("markAllRoomsRead", () => {
  it("sends one request per Room with that Room's cursor", async () => {
    const write = vi.fn((target: { roomId: string; throughRoomSeq: number }) =>
      Promise.resolve({
        read_through_room_seq: target.throughRoomSeq,
        room_id: target.roomId,
      }),
    );

    const report = await markAllRoomsRead(
      [
        { roomId: "room-a", throughRoomSeq: 12 },
        { roomId: "room-b", throughRoomSeq: 7 },
      ],
      write,
    );

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith({
      roomId: "room-a",
      throughRoomSeq: 12,
    });
    expect(write).toHaveBeenCalledWith({
      roomId: "room-b",
      throughRoomSeq: 7,
    });
    expect(report).toEqual({
      failed: 0,
      message: "2 Rooms marked read.",
      read: 2,
    });
  });

  it("keeps a failed Room unacknowledged and reports the split", async () => {
    const settled: Array<{
      acknowledgement?: { readThroughRoomSeq: number; roomId: string };
      completed: number;
      total: number;
    }> = [];
    const write = vi.fn((target: { roomId: string; throughRoomSeq: number }) =>
      target.roomId === "room-b"
        ? Promise.reject(new Error("Read state rejected"))
        : Promise.resolve({
            read_through_room_seq: target.throughRoomSeq,
            room_id: target.roomId,
          }),
    );

    const report = await markAllRoomsRead(
      [
        { roomId: "room-a", throughRoomSeq: 12 },
        { roomId: "room-b", throughRoomSeq: 7 },
      ],
      write,
      (settlement) => settled.push(settlement),
    );

    expect(report).toEqual({
      failed: 1,
      message: "1 marked read, 1 failed.",
      read: 1,
    });
    expect(settled).toHaveLength(2);
    expect(
      settled.find(
        (settlement) => settlement.acknowledgement?.roomId === "room-b",
      )?.acknowledgement,
    ).toBeUndefined();
    expect(
      settled.find(
        (settlement) => settlement.acknowledgement?.roomId === "room-a",
      )?.acknowledgement,
    ).toEqual({ readThroughRoomSeq: 12, roomId: "room-a" });
    expect(settled.at(-1)?.completed).toBe(2);
    expect(settled.at(-1)?.total).toBe(2);
  });

  it("keeps at most the stated number of requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const write = vi.fn(
      (target: { roomId: string; throughRoomSeq: number }) =>
        new Promise<{ read_through_room_seq: number; room_id: string }>(
          (resolve) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            setTimeout(() => {
              inFlight -= 1;
              resolve({
                read_through_room_seq: target.throughRoomSeq,
                room_id: target.roomId,
              });
            }, 0);
          },
        ),
    );
    const targets = Array.from({ length: 7 }, (_unused, index) => ({
      roomId: `room-${index}`,
      throughRoomSeq: index + 1,
    }));

    const report = await markAllRoomsRead(targets, write);

    expect(report.read).toBe(7);
    expect(write).toHaveBeenCalledTimes(7);
    expect(peak).toBe(MARK_ALL_ROOMS_READ_CONCURRENCY);
  });
});

describe("describeMarkAllRoomsRead", () => {
  it("names a full success", () => {
    expect(describeMarkAllRoomsRead(1, 0)).toBe("1 Room marked read.");
    expect(describeMarkAllRoomsRead(12, 0)).toBe("12 Rooms marked read.");
  });

  it("counts both sides of a partial failure", () => {
    expect(describeMarkAllRoomsRead(12, 1)).toBe("12 marked read, 1 failed.");
  });
});

function unreadRoom(
  id: string,
  latestRoomSeq: number,
  readThroughRoomSeq: number,
): TeamHubRoomListItem {
  return {
    ...room(id),
    latest_message: {
      author: {
        display_name: "Jenny",
        id: "actor-jenny",
        kind: "human",
        tenant_id: "tenant-a",
      },
      created_at: "2026-11-15T09:00:00Z",
      id: `message-${id}`,
      raw_message: "Newest message",
      room_seq: latestRoomSeq,
    },
    read_through_room_seq: readThroughRoomSeq,
    unread_message_count: latestRoomSeq - readThroughRoomSeq,
  };
}

function readRoom(
  id: string,
  latestRoomSeq: number,
  readThroughRoomSeq: number,
): TeamHubRoomListItem {
  return {
    ...unreadRoom(id, latestRoomSeq, readThroughRoomSeq),
    unread_message_count: 0,
  };
}

function room(id: string): TeamHubRoomListItem {
  return {
    created_at: "2026-11-15T08:00:00Z",
    created_by: {
      display_name: "Jenny",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-a",
    },
    id,
    kind: "room",
    latest_room_seq: 12,
    name: id,
    read_through_room_seq: 0,
    tenant_id: "tenant-a",
    unread_mention_count: 0,
    unread_message_count: 3,
    updated_at: "2026-11-15T09:00:00Z",
  };
}
