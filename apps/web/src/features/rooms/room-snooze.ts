import { useEffect, useState } from "react";

import { nextLocalMorning } from "./room-mention-snooze";

const SNOOZE_PREFIX = "room-snooze.v1:";
const SNOOZE_CHANGED = "room-snooze-changed";

/** One hour, the shortest choice the Room row menu offers. */
export const ROOM_SNOOZE_HOUR_MS = 60 * 60 * 1000;

/**
 * Room id to the instant its snooze ends, as an ISO string. A Room snooze
 * belongs to one Account in this browser and only hides the row; it is not the
 * mention snooze and changes nothing the server knows or counts.
 */
export type RoomSnooze = Readonly<Record<string, string>>;

export type RoomSnoozeChoice = "hour" | "morning";

export function roomSnoozeUntil(choice: RoomSnoozeChoice, now: Date): Date {
  return choice === "hour"
    ? new Date(now.getTime() + ROOM_SNOOZE_HOUR_MS)
    : nextLocalMorning(now);
}

export function withRoomSnooze(
  snooze: RoomSnooze,
  roomId: string,
  until: Date,
): RoomSnooze {
  return { ...snooze, [roomId]: until.toISOString() };
}

export function withoutRoomSnooze(
  snooze: RoomSnooze,
  roomId: string,
): RoomSnooze {
  const next = { ...snooze };
  delete next[roomId];
  return next;
}

/** Drops every entry whose instant has passed, so nothing needs a timer. */
export function pruneRoomSnooze(snooze: RoomSnooze, now: Date): RoomSnooze {
  const live: Record<string, string> = {};
  for (const [roomId, until] of Object.entries(snooze)) {
    if (isLive(until, now)) live[roomId] = until;
  }
  return live;
}

export function isRoomSnoozed(
  snooze: RoomSnooze,
  roomId: string,
  now: Date,
): boolean {
  const until = snooze[roomId];
  return until !== undefined && isLive(until, now);
}

/** The Rooms whose rows stay hidden right now. */
export function roomSnoozedIds(
  snooze: RoomSnooze,
  now: Date,
): ReadonlySet<string> {
  return new Set(Object.keys(pruneRoomSnooze(snooze, now)));
}

/**
 * Reads this Account's Room snoozes as of `now`, dropping expired and
 * unreadable entries. Blocked or corrupt storage means nothing is snoozed
 * rather than a broken Room list.
 */
export function readRoomSnooze(
  accountId: string | undefined,
  now: Date,
): RoomSnooze {
  if (!accountId) return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(snoozeKey(accountId)) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const snoozes: Record<string, string> = {};
    for (const [roomId, until] of Object.entries(parsed)) {
      // Storage is untrusted: anything but a string instant is no snooze.
      if (typeof until === "string") snoozes[roomId] = until;
    }
    return pruneRoomSnooze(snoozes, now);
  } catch {
    return {};
  }
}

export function writeRoomSnooze(
  accountId: string | undefined,
  snooze: RoomSnooze,
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(snoozeKey(accountId), JSON.stringify(snooze));
  } catch {
    // Blocked storage leaves the Room list working without the choice.
    return;
  }
  // Same-tab readers refresh; other tabs hear the storage event instead.
  window.dispatchEvent(new Event(SNOOZE_CHANGED));
}

export function setRoomSnooze(
  accountId: string | undefined,
  roomId: string,
  until: Date,
  now: Date,
): void {
  writeRoomSnooze(
    accountId,
    withRoomSnooze(readRoomSnooze(accountId, now), roomId, until),
  );
}

export function clearRoomSnooze(
  accountId: string | undefined,
  roomId: string,
  now: Date,
): void {
  writeRoomSnooze(
    accountId,
    withoutRoomSnooze(readRoomSnooze(accountId, now), roomId),
  );
}

export function subscribeRoomSnooze(listener: () => void): () => void {
  window.addEventListener(SNOOZE_CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(SNOOZE_CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * This Account's live Room snoozes. A write in this tab or another one re-reads
 * them, and each reader judges expiry against the moment it acts.
 */
export function useRoomSnooze(accountId: string | undefined): RoomSnooze {
  const [snooze, setSnooze] = useState<RoomSnooze>(() =>
    readRoomSnooze(accountId, new Date()),
  );
  useEffect(() => {
    const refresh = () => setSnooze(readRoomSnooze(accountId, new Date()));
    refresh();
    return subscribeRoomSnooze(refresh);
  }, [accountId]);
  return snooze;
}

function isLive(until: string, now: Date): boolean {
  const instant = Date.parse(until);
  return Number.isFinite(instant) && instant > now.getTime();
}

function snoozeKey(accountId: string) {
  return `${SNOOZE_PREFIX}${accountId}`;
}
