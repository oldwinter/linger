/**
 * The first moment of a Meeting Summary topic, taken from the heading's
 * representative range (`00:01:00 - 00:05:00` or `00:01:00 – 00:05:00`).
 * A range that does not open with a clock is not a place to start the recording.
 */
export function topicStartSeconds(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s|$)/u.exec(time.trim());
  if (!match) return null;
  const head = Number(match[1]);
  const middle = Number(match[2]);
  const tail = match[3] === undefined ? undefined : Number(match[3]);
  if (tail === undefined) {
    if (middle > 59) return null;
    return head * 60 + middle;
  }
  if (middle > 59 || tail > 59) return null;
  return head * 3600 + middle * 60 + tail;
}
