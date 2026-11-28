import { useEffect, useState } from "react";

import {
  ACCOUNT_PREFERENCE_KEY_PREFIXES,
  removePreferenceKeys,
  storedPreferenceKeys,
} from "@/lib/local-preference-keys";

import {
  MENTION_SNOOZE_HOUR_MS,
  nextLocalMorning,
} from "./room-mention-snooze";

const PAUSE_PREFIX = ACCOUNT_PREFERENCE_KEY_PREFIXES.desktopNotificationPause;
const PAUSE_CHANGED = "desktop-notification-pause-changed";

/** The two pauses the settings section offers. */
export type DesktopNotificationPauseChoice = "hour" | "morning";

/**
 * When a pause of `choice` ends. "Morning" is the mention snooze's next local
 * morning, so a pause and a Room snooze chosen together end at the same instant.
 */
export function desktopNotificationPauseUntil(
  choice: DesktopNotificationPauseChoice,
  now: Date,
): Date {
  return choice === "hour"
    ? new Date(now.getTime() + MENTION_SNOOZE_HOUR_MS)
    : nextLocalMorning(now);
}

/**
 * Whether a pause ending at `until` holds right now. A passed instant needs no
 * cleanup write: every reader judges it against its own clock.
 */
export function isDesktopNotificationPaused(
  until: string | undefined,
  now: Date,
): boolean {
  if (!until) return false;
  const instant = Date.parse(until);
  return Number.isFinite(instant) && instant > now.getTime();
}

/**
 * This Account's pause end, or undefined when nothing is stored. Unreadable
 * storage pauses nothing rather than silencing every notification. An expired
 * instant is still returned; callers judge it with `isDesktopNotificationPaused`.
 */
export function readDesktopNotificationPause(
  accountId: string | undefined,
): string | undefined {
  if (!accountId) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(pauseKey(accountId)) ?? "null",
    );
    return typeof parsed === "string" && Number.isFinite(Date.parse(parsed))
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export function setDesktopNotificationPause(
  accountId: string | undefined,
  until: Date,
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(
      pauseKey(accountId),
      JSON.stringify(until.toISOString()),
    );
  } catch {
    // Blocked storage leaves notifications running without the choice.
    return;
  }
  // Same-tab readers refresh; other tabs hear the storage event instead.
  window.dispatchEvent(new Event(PAUSE_CHANGED));
}

export function clearDesktopNotificationPause(
  accountId: string | undefined,
): void {
  if (!accountId) return;
  try {
    window.localStorage.removeItem(pauseKey(accountId));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(PAUSE_CHANGED));
}

/** Whether this browser pauses notifications for any Account. */
export function hasDesktopNotificationPauses(): boolean {
  return storedPreferenceKeys([PAUSE_PREFIX]).length > 0;
}

/** Ends every desktop notification pause in this browser, for every Account. */
export function clearDesktopNotificationPauses(): void {
  removePreferenceKeys([PAUSE_PREFIX]);
  window.dispatchEvent(new Event(PAUSE_CHANGED));
}

export function subscribeDesktopNotificationPause(
  listener: () => void,
): () => void {
  window.addEventListener(PAUSE_CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(PAUSE_CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

/** This Account's pause end; a write here or in another tab re-reads it. */
export function useDesktopNotificationPause(
  accountId: string | undefined,
): string | undefined {
  const [until, setUntil] = useState(() =>
    readDesktopNotificationPause(accountId),
  );
  useEffect(() => {
    const refresh = () => setUntil(readDesktopNotificationPause(accountId));
    refresh();
    return subscribeDesktopNotificationPause(refresh);
  }, [accountId]);
  return until;
}

function pauseKey(accountId: string) {
  return `${PAUSE_PREFIX}${accountId}`;
}
