import {
  removePreferenceKeys,
  storedPreferenceKeys,
} from "@/lib/local-preference-keys";

const SPEED_PREFIX = "meeting-playback-speed.v1:";

/** The speeds a recording offers, slowest first. */
export const MEETING_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export type MeetingPlaybackRate = (typeof MEETING_PLAYBACK_RATES)[number];

/** The rate a meeting opens at until its listener chooses another. */
export const DEFAULT_MEETING_PLAYBACK_RATE: MeetingPlaybackRate = 1;

export function isMeetingPlaybackRate(
  value: unknown,
): value is MeetingPlaybackRate {
  return MEETING_PLAYBACK_RATES.some((rate) => rate === value);
}

/**
 * This Account's chosen speed. Storage is untrusted and a removed or unreadable
 * value is no choice at all, so both fall back to the default.
 */
export function readMeetingPlaybackSpeed(
  accountId: string | undefined,
): MeetingPlaybackRate {
  if (!accountId) return DEFAULT_MEETING_PLAYBACK_RATE;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(speedKey(accountId)) ?? "null",
    );
    return isMeetingPlaybackRate(value) ? value : DEFAULT_MEETING_PLAYBACK_RATE;
  } catch {
    return DEFAULT_MEETING_PLAYBACK_RATE;
  }
}

export function writeMeetingPlaybackSpeed(
  accountId: string | undefined,
  rate: MeetingPlaybackRate,
): void {
  if (!accountId || !isMeetingPlaybackRate(rate)) return;
  try {
    window.localStorage.setItem(speedKey(accountId), JSON.stringify(rate));
  } catch {
    // Blocked storage keeps this meeting's choice for this playback only.
  }
}

/** Whether this browser remembers a speed for any Account. */
export function hasMeetingPlaybackSpeed(): boolean {
  return storedPreferenceKeys([SPEED_PREFIX]).length > 0;
}

/** Forgets every remembered speed in this browser, for every Account. */
export function clearMeetingPlaybackSpeed(): void {
  removePreferenceKeys([SPEED_PREFIX]);
}

function speedKey(accountId: string) {
  return `${SPEED_PREFIX}${accountId}`;
}
