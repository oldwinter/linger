/** Long enough that switching windows for a moment is not coming back. */
export const AWAY_BEFORE_RETURN_MS = 60_000;

/** A room as the list already knows it: identity, kind, and how far it has moved. */
export interface RoomReturnFact {
  id: string;
  kind: string;
  seq: number;
}

/**
 * The one room that moved while this window was hidden, when that is the only
 * one and it is not already on screen. Several rooms, or none, stay put: the
 * recap already names a crowd.
 */
export function roomToOpenOnReturn({
  activeRoomId,
  after,
  before,
  dialogOpen,
  hiddenForMs,
  ignoredRoomIds,
  writing,
}: {
  activeRoomId?: string;
  after: readonly RoomReturnFact[];
  before: readonly RoomReturnFact[];
  dialogOpen: boolean;
  hiddenForMs: number;
  ignoredRoomIds?: ReadonlySet<string>;
  writing: boolean;
}): string | undefined {
  if (hiddenForMs < AWAY_BEFORE_RETURN_MS) return undefined;
  if (writing || dialogOpen) return undefined;
  if (before.length === 0) return undefined;
  const prior = new Map(before.map((room) => [room.id, room.seq]));
  const arrived: string[] = [];
  for (const room of after) {
    if (room.kind === "thread") continue;
    if (ignoredRoomIds?.has(room.id)) continue;
    const previous = prior.get(room.id);
    if (previous === undefined) {
      if (room.seq > 0) arrived.push(room.id);
      continue;
    }
    if (room.seq > previous) arrived.push(room.id);
  }
  if (arrived.length !== 1) return undefined;
  const id = arrived[0];
  if (!id || id === activeRoomId) return undefined;
  return id;
}
