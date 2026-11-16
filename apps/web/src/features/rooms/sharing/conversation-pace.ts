/** The shortest beat, also the wait after the last message. */
export const CONVERSATION_BEAT_MIN_MS = 700;
/** A long real pause never makes the watcher wait longer than this. */
export const CONVERSATION_BEAT_MAX_MS = 1600;
/** A gap at least this long is named as a quiet stretch. */
const QUIET_GAP_MS = 3 * 60 * 1000;

function gapMs(previous: string, next: string) {
  const gap = Date.parse(next) - Date.parse(previous);
  return Number.isFinite(gap) ? gap : 0;
}

/**
 * How long to hold one message before the next, from the real gap between
 * them. A minute of the conversation is about a second of watching. A short
 * reply never flashes by faster than the minimum beat.
 */
export function conversationBeatDelay(previous: string, next: string) {
  const gap = gapMs(previous, next);
  if (gap <= 0) return CONVERSATION_BEAT_MIN_MS;
  return Math.min(
    CONVERSATION_BEAT_MAX_MS,
    Math.max(CONVERSATION_BEAT_MIN_MS, Math.round(gap / 60)),
  );
}

export function conversationWasQuiet(previous: string, next: string) {
  return gapMs(previous, next) >= QUIET_GAP_MS;
}

export function conversationSpeaker(
  name: string,
  previousAt: string | undefined,
  at: string,
) {
  if (previousAt && conversationWasQuiet(previousAt, at)) {
    return `${name}, after a quiet stretch`;
  }
  return name;
}
