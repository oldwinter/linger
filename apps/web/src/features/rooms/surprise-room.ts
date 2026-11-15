import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

export function surprisePath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/surprise`;
}

export function surpriseRoomTitle(room: TeamHubRoomListItem) {
  return room.direct_peer?.display_name ?? room.name;
}

/** Threads are a message inside a room, not a place the spin can land. */
export function roomsToSpin(rooms: readonly TeamHubRoomListItem[]) {
  return rooms
    .filter((room) => room.kind !== "thread")
    .slice()
    .sort((left, right) =>
      surpriseRoomTitle(left).localeCompare(surpriseRoomTitle(right)),
    );
}

export function chooseSurprise(
  rooms: readonly TeamHubRoomListItem[],
  random: () => number,
) {
  const list = roomsToSpin(rooms);
  if (list.length === 0) return;
  const index = Math.min(
    list.length - 1,
    Math.max(0, Math.floor(random() * list.length)),
  );
  return list[index];
}
