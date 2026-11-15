import { useEffect, useSyncExternalStore } from "react";

const MORNING_HOUR = 8;
const HOUR_MS = 60 * 60 * 1000;

const listeners = new Set<() => void>();
/** Used when this computer has no localStorage, including a blocked store. */
const memory = new Map<string, number>();

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return;
  }
}

function storageKey(accountId: string) {
  return `linger.another-me-quiet.${encodeURIComponent(accountId)}`;
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("linger.another-me-quiet.")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Epoch milliseconds the hold lasts until, when one is still in the future. */
export function readQuietUntil(
  accountId: string,
  now = Date.now(),
): number | undefined {
  const storage = browserStorage();
  let until: number | undefined;
  if (!storage) {
    until = memory.get(accountId);
  } else {
    try {
      const raw = storage.getItem(storageKey(accountId));
      until = raw === null ? undefined : Number(raw);
    } catch {
      until = memory.get(accountId);
    }
  }
  if (until === undefined || !Number.isFinite(until) || until <= now) return;
  return until;
}

/** `undefined` ends the hold. A blocked store keeps the choice for this tab. */
export function writeQuietUntil(accountId: string, until: number | undefined) {
  const storage = browserStorage();
  const remember = () => {
    if (until === undefined) memory.delete(accountId);
    else memory.set(accountId, until);
  };
  if (!storage) {
    remember();
  } else {
    try {
      if (until === undefined) storage.removeItem(storageKey(accountId));
      else storage.setItem(storageKey(accountId), String(until));
      memory.delete(accountId);
    } catch {
      remember();
    }
  }
  notify();
}

/** 8:00 local. Before that hour, later this morning; otherwise the next morning. */
export function morningQuietUntil(now: Date): number {
  const until = new Date(now);
  until.setHours(MORNING_HOUR, 0, 0, 0);
  if (until.getTime() <= now.getTime()) until.setDate(until.getDate() + 1);
  return until.getTime();
}

export function hourQuietUntil(now: Date): number {
  return now.getTime() + HOUR_MS;
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

function sameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** What the card and Settings say while reminders are held. */
export function quietLabel(until: number, now: Date): string {
  const end = new Date(until);
  const time = timeFormat.format(end);
  if (sameCalendarDay(end, now)) return `Quiet until ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameCalendarDay(end, tomorrow)) return `Quiet until ${time} tomorrow`;
  const day = dayFormat.format(end);
  return `Quiet until ${time} on ${day}`;
}

/**
 * The hold for this Account on this computer. Reminders are shown by the
 * window, so the hold is not a My Rule and does not change the Chat.
 */
export function useAnotherMeQuiet(accountId: string | undefined) {
  const until = useSyncExternalStore(
    subscribe,
    () => (accountId ? (readQuietUntil(accountId) ?? 0) : 0),
    () => 0,
  );
  useEffect(() => {
    if (!accountId || until <= 0) return;
    const timer = window.setTimeout(
      notify,
      Math.max(0, until - Date.now()) + 250,
    );
    return () => window.clearTimeout(timer);
  }, [accountId, until]);
  const active = until > 0 ? until : undefined;
  return {
    label: active === undefined ? undefined : quietLabel(active, new Date()),
    until: active,
    quietForHour() {
      if (accountId) writeQuietUntil(accountId, hourQuietUntil(new Date()));
    },
    quietUntilMorning() {
      if (accountId) writeQuietUntil(accountId, morningQuietUntil(new Date()));
    },
    endQuiet() {
      if (accountId) writeQuietUntil(accountId, undefined);
    },
  };
}
