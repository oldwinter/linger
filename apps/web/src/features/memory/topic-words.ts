const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u;
const CUE =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/u;

export interface TimedTurn {
  end: number;
  start: number;
  text: string;
}

/** Turns that carry a clock, in spoken order. Headings and undated blocks stay out. */
export function timedTranscriptTurns(markdown: string): TimedTurn[] {
  const turns: TimedTurn[] = [];
  for (const block of markdown.split(/\r?\n\s*\r?\n/u)) {
    const trimmed = block.trim();
    if (!trimmed || /^#{1,6}(?:\s|$)/u.test(trimmed)) continue;
    const cue = CUE.exec(trimmed);
    if (!cue) continue;
    const start = clockSeconds(cue[1] ?? "");
    const end = clockSeconds(cue[2] ?? "");
    if (start === null || end === null) continue;
    const text = trimmed.slice(cue[0].length).replace(/\s+/gu, " ").trim();
    if (!text) continue;
    turns.push({ end, start, text });
  }
  return turns;
}

/**
 * The spoken lines that begin inside a topic's clock range. A topic without
 * a range has no lines to show.
 */
export function wordsInTopic(turns: readonly TimedTurn[], range: string) {
  const window = rangeSeconds(range);
  if (!window) return [];
  return turns
    .filter((turn) => turn.start >= window.start && turn.start < window.end)
    .map((turn) => turn.text);
}

function rangeSeconds(range: string) {
  const [startText, endText] = range.split(/\s*[-–—]\s*/u);
  if (!startText || !endText) return undefined;
  const start = clockSeconds(startText);
  const end = clockSeconds(endText);
  if (start === null || end === null || end <= start) return undefined;
  return { end, start };
}

function clockSeconds(value: string): number | null {
  const match = CLOCK.exec(value.trim());
  if (!match) return null;
  const head = Number(match[1]);
  const middle = Number(match[2]);
  const tail = match[3] === undefined ? undefined : Number(match[3]);
  if (middle > 59) return null;
  if (tail === undefined) return head * 60 + middle;
  if (tail > 59) return null;
  return head * 3600 + middle * 60 + tail;
}
