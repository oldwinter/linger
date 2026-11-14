const storagePrefix = "linger.meeting-playback.";
const listeners = new Set<() => void>();
let version = 0;

/** Seconds already heard, or 0 when this meeting has not been left mid-recording. */
export function readMeetingPlayback(
  accountId: string,
  captureId: string,
): number {
  try {
    const stored = globalThis.localStorage?.getItem(
      storageKey(accountId, captureId),
    );
    if (!stored) return 0;
    const seconds = Number(stored);
    return Number.isFinite(seconds) && seconds > 3 ? seconds : 0;
  } catch {
    return 0;
  }
}

/**
 * Keeps a place in the recording. A spot at the start or the end is dropped,
 * so the next open begins cleanly.
 */
export function writeMeetingPlayback(
  accountId: string,
  captureId: string,
  seconds: number,
  duration = Number.POSITIVE_INFINITY,
) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const key = storageKey(accountId, captureId);
    if (!Number.isFinite(seconds) || seconds <= 3 || seconds >= duration - 5) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, String(Math.floor(seconds)));
    }
  } catch {
    // The player still shows the playhead when this browser cannot store it.
  }
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeMeetingPlayback(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function meetingPlaybackVersion() {
  return version;
}

function storageKey(accountId: string, captureId: string) {
  return `${storagePrefix}${encodeURIComponent(accountId)}.${encodeURIComponent(captureId)}`;
}
