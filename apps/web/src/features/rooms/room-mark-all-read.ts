import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { roomMarkReadCursor, type RoomMarkReadTarget } from "./room-mark-read";

/** Acknowledgements in flight at once, so a long list does not flood TeamHub. */
export const MARK_ALL_ROOMS_READ_CONCURRENCY = 3;

/** What one Room's read-state write returned; absent when it failed. */
export interface RoomReadSettlement {
  acknowledgement?: { readThroughRoomSeq: number; roomId: string };
  /** Rooms settled so far, this one included. */
  completed: number;
  total: number;
}

export interface MarkAllRoomsReadReport {
  failed: number;
  message: string;
  read: number;
}

/** The Rooms that can acknowledge a cursor, in the order the list shows them. */
export function markAllRoomsReadTargets(
  rooms: readonly TeamHubRoomListItem[],
): RoomMarkReadTarget[] {
  return rooms.flatMap((room) => {
    const throughRoomSeq = roomMarkReadCursor(room);
    return throughRoomSeq === undefined
      ? []
      : [{ roomId: room.id, throughRoomSeq }];
  });
}

/**
 * Runs the existing read-state request once per Room, a few at a time, and
 * reports what TeamHub accepted. A failed Room keeps its unread state and is
 * counted in the report instead of being treated as read.
 */
export async function markAllRoomsRead(
  targets: readonly RoomMarkReadTarget[],
  write: (target: RoomMarkReadTarget) => Promise<{
    read_through_room_seq: number;
    room_id: string;
  }>,
  onSettled?: (settlement: RoomReadSettlement) => void,
): Promise<MarkAllRoomsReadReport> {
  let read = 0;
  let failed = 0;
  let completed = 0;
  await runWithConcurrency(
    targets,
    MARK_ALL_ROOMS_READ_CONCURRENCY,
    async (target) => {
      let acknowledgement: RoomReadSettlement["acknowledgement"];
      try {
        const state = await write(target);
        acknowledgement = {
          readThroughRoomSeq: state.read_through_room_seq,
          roomId: state.room_id,
        };
        read += 1;
      } catch {
        failed += 1;
      }
      completed += 1;
      onSettled?.({ acknowledgement, completed, total: targets.length });
    },
  );
  return { failed, message: describeMarkAllRoomsRead(read, failed), read };
}

export function describeMarkAllRoomsRead(read: number, failed: number) {
  if (failed === 0) {
    return `${read} ${read === 1 ? "Room" : "Rooms"} marked read.`;
  }
  return `${read} marked read, ${failed} failed.`;
}

/** At most `limit` runs are in flight; each worker pulls the next item. */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await run(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}
