import { useEffect, useState } from "react";

const SNOOZE_PREFIX = "room-mention-snooze.v1:";
const MUTE_PREFIX = "room-mention-mute.v1:";
const PREFERENCES_CHANGED = "room-mention-preferences-changed";

/** One hour, the shortest choice the Room row menu offers. */
export const MENTION_SNOOZE_HOUR_MS = 60 * 60 * 1000;

/** The local hour a snooze lasts until when the person wants a quiet night. */
const MORNING_HOUR = 8;

/**
 * Room id to the instant its mention snooze ends, as an ISO string. A snooze
 * belongs to one Account in this browser, like the unread filter; it changes
 * nothing the server knows or counts.
 */
export type RoomMentionSnooze = Readonly<Record<string, string>>;

/** Room ids whose mentions stay quiet until the person unmutes them. */
export type RoomMentionMute = ReadonlySet<string>;

export type RoomMentionSnoozeChoice = "hour" | "morning";

/** The next local morning strictly after `now`, across a date boundary. */
export function nextLocalMorning(now: Date): Date {
  const morning = new Date(now);
  morning.setHours(MORNING_HOUR, 0, 0, 0);
  if (morning <= now) morning.setDate(morning.getDate() + 1);
  return morning;
}

export function roomMentionSnoozeUntil(
  choice: RoomMentionSnoozeChoice,
  now: Date,
): Date {
  return choice === "hour"
    ? new Date(now.getTime() + MENTION_SNOOZE_HOUR_MS)
    : nextLocalMorning(now);
}

export function withRoomMentionSnooze(
  snooze: RoomMentionSnooze,
  roomId: string,
  until: Date,
): RoomMentionSnooze {
  return { ...snooze, [roomId]: until.toISOString() };
}

export function withoutRoomMentionSnooze(
  snooze: RoomMentionSnooze,
  roomId: string,
): RoomMentionSnooze {
  const next = { ...snooze };
  delete next[roomId];
  return next;
}

/** Drops every entry whose instant has passed, so nothing needs a timer. */
export function pruneRoomMentionSnooze(
  snooze: RoomMentionSnooze,
  now: Date,
): RoomMentionSnooze {
  const live: Record<string, string> = {};
  for (const [roomId, until] of Object.entries(snooze)) {
    if (isLive(until, now)) live[roomId] = until;
  }
  return live;
}

export function isRoomMentionSnoozed(
  snooze: RoomMentionSnooze,
  roomId: string,
  now: Date,
): boolean {
  const until = snooze[roomId];
  return until !== undefined && isLive(until, now);
}

/** The Rooms whose mentions stay quiet right now. */
export function snoozedRoomIds(
  snooze: RoomMentionSnooze,
  now: Date,
): ReadonlySet<string> {
  return new Set(Object.keys(pruneRoomMentionSnooze(snooze, now)));
}

export function withRoomMentionMute(
  mute: RoomMentionMute,
  roomId: string,
): RoomMentionMute {
  return new Set([...mute, roomId]);
}

export function withoutRoomMentionMute(
  mute: RoomMentionMute,
  roomId: string,
): RoomMentionMute {
  const next = new Set(mute);
  next.delete(roomId);
  return next;
}

export function isRoomMentionMuted(
  mute: RoomMentionMute,
  roomId: string,
): boolean {
  return mute.has(roomId);
}

/** The Rooms whose mentions stay quiet right now: snoozed or muted. */
export function quietRoomIds(
  snooze: RoomMentionSnooze,
  mute: RoomMentionMute,
  now: Date,
): ReadonlySet<string> {
  const quiet = new Set<string>(
    Object.keys(pruneRoomMentionSnooze(snooze, now)),
  );
  for (const roomId of mute) quiet.add(roomId);
  return quiet;
}

/**
 * Reads this Account's snoozes as of `now`, dropping expired and unreadable
 * entries. Blocked or corrupt storage means nothing is snoozed rather than a
 * broken Room list.
 */
export function readRoomMentionSnooze(
  accountId: string | undefined,
  now: Date,
): RoomMentionSnooze {
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
    return pruneRoomMentionSnooze(snoozes, now);
  } catch {
    return {};
  }
}

export function writeRoomMentionSnooze(
  accountId: string | undefined,
  snooze: RoomMentionSnooze,
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(snoozeKey(accountId), JSON.stringify(snooze));
  } catch {
    // Blocked storage leaves the Room list working without the choice.
    return;
  }
  // Same-tab readers refresh; other tabs hear the storage event instead.
  window.dispatchEvent(new Event(PREFERENCES_CHANGED));
}

export function setRoomMentionSnooze(
  accountId: string | undefined,
  roomId: string,
  until: Date,
  now: Date,
): void {
  writeRoomMentionSnooze(
    accountId,
    withRoomMentionSnooze(readRoomMentionSnooze(accountId, now), roomId, until),
  );
}

export function clearRoomMentionSnooze(
  accountId: string | undefined,
  roomId: string,
  now: Date,
): void {
  writeRoomMentionSnooze(
    accountId,
    withoutRoomMentionSnooze(readRoomMentionSnooze(accountId, now), roomId),
  );
}

/**
 * This Account's muted Rooms. Blocked or corrupt storage means nothing is
 * muted rather than a broken Room list.
 */
export function readRoomMentionMute(
  accountId: string | undefined,
): RoomMentionMute {
  if (!accountId) return new Set();
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(muteKey(accountId)) ?? "[]",
    );
    if (!Array.isArray(parsed)) return new Set();
    // Storage is untrusted: anything but a room id string is no mute.
    return new Set(
      parsed.filter((roomId): roomId is string => typeof roomId === "string"),
    );
  } catch {
    return new Set();
  }
}

export function writeRoomMentionMute(
  accountId: string | undefined,
  mute: RoomMentionMute,
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(muteKey(accountId), JSON.stringify([...mute]));
  } catch {
    // Blocked storage leaves the Room list working without the choice.
    return;
  }
  window.dispatchEvent(new Event(PREFERENCES_CHANGED));
}

/** Mutes a Room until the person unmutes it, ending any snooze it held. */
export function muteRoomMention(
  accountId: string | undefined,
  roomId: string,
  now: Date,
): void {
  writeRoomMentionSnooze(
    accountId,
    withoutRoomMentionSnooze(readRoomMentionSnooze(accountId, now), roomId),
  );
  writeRoomMentionMute(
    accountId,
    withRoomMentionMute(readRoomMentionMute(accountId), roomId),
  );
}

/** Unmuting leaves the Room with no leftover snooze either. */
export function unmuteRoomMention(
  accountId: string | undefined,
  roomId: string,
): void {
  writeRoomMentionMute(
    accountId,
    withoutRoomMentionMute(readRoomMentionMute(accountId), roomId),
  );
}

export function subscribeRoomMentionPreferences(
  listener: () => void,
): () => void {
  window.addEventListener(PREFERENCES_CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(PREFERENCES_CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * This Account's live snoozes. A write in this tab or another one re-reads
 * them, and each reader judges expiry against the moment it acts.
 */
export function useRoomMentionSnooze(
  accountId: string | undefined,
): RoomMentionSnooze {
  const [snooze, setSnooze] = useState<RoomMentionSnooze>(() =>
    readRoomMentionSnooze(accountId, new Date()),
  );
  useEffect(() => {
    const refresh = () =>
      setSnooze(readRoomMentionSnooze(accountId, new Date()));
    refresh();
    return subscribeRoomMentionPreferences(refresh);
  }, [accountId]);
  return snooze;
}

/** This Account's muted Rooms; a mute or an unmute re-reads them. */
export function useRoomMentionMute(
  accountId: string | undefined,
): RoomMentionMute {
  const [mute, setMute] = useState<RoomMentionMute>(() =>
    readRoomMentionMute(accountId),
  );
  useEffect(() => {
    const refresh = () => setMute(readRoomMentionMute(accountId));
    refresh();
    return subscribeRoomMentionPreferences(refresh);
  }, [accountId]);
  return mute;
}

function isLive(until: string, now: Date): boolean {
  const instant = Date.parse(until);
  return Number.isFinite(instant) && instant > now.getTime();
}

function snoozeKey(accountId: string) {
  return `${SNOOZE_PREFIX}${accountId}`;
}

function muteKey(accountId: string) {
  return `${MUTE_PREFIX}${accountId}`;
}
