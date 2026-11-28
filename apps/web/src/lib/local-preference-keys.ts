/** Canonical localStorage key prefixes for account-scoped browser preferences. */
export const ACCOUNT_PREFERENCE_KEY_PREFIXES = {
  desktopNotificationPause: "desktop-notification-pause.v1:",
  lastRoom: "last-room.v1:",
  meetingPlaybackSpeed: "meeting-playback-speed.v1:",
  meetingResume: "meeting-resume.v1:",
  roomMentionMute: "room-mention-mute.v1:",
  roomMentionSnooze: "room-mention-snooze.v1:",
  roomSnooze: "room-snooze.v1:",
  roomUnreadFilter: "room-unread-filter.v1:",
} as const;

/** Removes all account-scoped browser preference keys without importing feature hooks. */
export function clearAccountPreferenceKeys(): void {
  removePreferenceKeys(Object.values(ACCOUNT_PREFERENCE_KEY_PREFIXES));
}

/**
 * This browser's stored keys whose names start with any of the prefixes.
 * Blocked or unavailable storage holds nothing.
 */
export function storedPreferenceKeys(prefixes: readonly string[]): string[] {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

/** Removes every stored key that starts with any of the prefixes. */
export function removePreferenceKeys(prefixes: readonly string[]): void {
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Blocked storage has nothing this app can remove.
  }
}

/** Notifies same-tab subscribers when a preference store changes. */
export function notifyPreferenceChange(eventName: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(eventName));
}

/** Subscribes to same-tab custom preference events and cross-tab storage updates. */
export function subscribePreferenceChange(
  eventName: string,
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", listener);
  };
}
