/**
 * The Room rows the list shows and the ones a Room snooze hides. A snoozed
 * Room leaves the list; the active Room always stays, so opening one never
 * hides the Room the person is reading.
 */
export function splitSnoozedRooms<T extends { id: string }>(
  rooms: readonly T[],
  snoozedRoomIds: ReadonlySet<string>,
  activeRoomId: string | undefined,
): { hidden: T[]; visible: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const room of rooms) {
    if (room.id === activeRoomId || !snoozedRoomIds.has(room.id)) {
      visible.push(room);
    } else {
      hidden.push(room);
    }
  }
  return { hidden, visible };
}
