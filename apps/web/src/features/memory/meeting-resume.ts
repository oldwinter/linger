import {
  ACCOUNT_PREFERENCE_KEY_PREFIXES,
  notifyPreferenceChange,
  removePreferenceKeys,
  storedPreferenceKeys,
  subscribePreferenceChange,
} from "@/lib/local-preference-keys";

const RESUME_PREFIX = ACCOUNT_PREFERENCE_KEY_PREFIXES.meetingResume;
const RESUME_CHANGED = "meeting-resume-changed";

/**
 * How many meetings one Account keeps remembered. Oldest saves leave first, so
 * a long archive cannot grow this store without bound.
 */
export const MEETING_RESUME_LIMIT = 20;

/** A position this close to the end restarts instead of resuming. */
export const MEETING_RESUME_TAIL_SECONDS = 5;

export interface MeetingResumeEntry {
  /** Seconds into the recording. */
  position: number;
  /** When it was stored, so eviction can drop the oldest save first. */
  savedAt: number;
}

/** Meeting id to the place its listener stopped, for one Account. */
export type MeetingResume = Readonly<Record<string, MeetingResumeEntry>>;

/**
 * Where a recording should start for a listener who was here before: the
 * remembered position when it lies inside the recording and not in its last
 * few seconds, which a finished listen would otherwise resume from.
 */
export function resumablePosition(
  position: number,
  duration: number,
): number | null {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return null;
  if (position <= 0 || duration <= 0) return null;
  return position <= duration - MEETING_RESUME_TAIL_SECONDS ? position : null;
}

/**
 * Reads this Account's remembered positions. Blocked or corrupt storage means
 * nothing is remembered rather than a broken player.
 */
export function readMeetingResume(
  accountId: string | undefined,
): MeetingResume {
  if (!accountId) return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(resumeKey(accountId)) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const resume: Record<string, MeetingResumeEntry> = {};
    for (const [meetingId, entry] of Object.entries(parsed)) {
      // Storage is untrusted: anything but two finite numbers is no position.
      if (!entry || typeof entry !== "object") continue;
      const { position, savedAt } = entry as {
        position?: unknown;
        savedAt?: unknown;
      };
      if (typeof position !== "number" || !Number.isFinite(position)) continue;
      if (position < 0) continue;
      if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) continue;
      resume[meetingId] = { position, savedAt };
    }
    return resume;
  } catch {
    return {};
  }
}

export function writeMeetingResume(
  accountId: string | undefined,
  resume: MeetingResume,
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(
      resumeKey(accountId),
      JSON.stringify(bounded(resume)),
    );
  } catch {
    // Blocked storage leaves the player working without the memory.
    return;
  }
  // Same-tab readers refresh; other tabs hear the storage event instead.
  notifyPreferenceChange(RESUME_CHANGED);
}

/** Remembers where one meeting stopped, dropping the oldest save if full. */
export function rememberMeetingPosition(
  accountId: string | undefined,
  meetingId: string | undefined,
  position: number,
  savedAt: number,
): void {
  if (!accountId || !meetingId) return;
  if (!Number.isFinite(position) || position <= 0) return;
  writeMeetingResume(accountId, {
    ...readMeetingResume(accountId),
    [meetingId]: { position, savedAt },
  });
}

/** Forgets one meeting, removing the Account's key once nothing is left. */
export function forgetMeetingPosition(
  accountId: string | undefined,
  meetingId: string | undefined,
): void {
  if (!accountId || !meetingId) return;
  const current = readMeetingResume(accountId);
  if (!(meetingId in current)) return;
  const next = { ...current };
  delete next[meetingId];
  if (!Object.keys(next).length) {
    try {
      window.localStorage.removeItem(resumeKey(accountId));
    } catch {
      // Blocked storage has nothing to forget.
    }
    notifyPreferenceChange(RESUME_CHANGED);
    return;
  }
  writeMeetingResume(accountId, next);
}

/** Whether this browser remembers a position for any Account. */
export function hasMeetingResume(): boolean {
  return storedPreferenceKeys([RESUME_PREFIX]).length > 0;
}

/** Forgets every remembered position in this browser, for every Account. */
export function clearMeetingResume(): void {
  removePreferenceKeys([RESUME_PREFIX]);
  notifyPreferenceChange(RESUME_CHANGED);
}

export function subscribeMeetingResume(listener: () => void): () => void {
  return subscribePreferenceChange(RESUME_CHANGED, listener);
}

/** Keeps the newest saves and drops the oldest first. */
function bounded(resume: MeetingResume): MeetingResume {
  const entries = Object.entries(resume);
  if (entries.length <= MEETING_RESUME_LIMIT) return resume;
  return Object.fromEntries(
    entries
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, MEETING_RESUME_LIMIT),
  );
}

function resumeKey(accountId: string) {
  return `${RESUME_PREFIX}${accountId}`;
}
