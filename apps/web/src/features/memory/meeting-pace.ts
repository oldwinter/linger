import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

/** The speeds the recording player already offers, used as the pace's bounds. */
const SLOWEST = 0.75;
const FASTEST = 2;

/** Fewer clocked turns than this is not a pace someone can hear. */
const MIN_TURNS = 4;

const STRUCTURAL_LINE = /^(?:#{1,6}(?:\s|$)|>)/u;
const CUE =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([\s\S]*)$/u;
const SPEAKER_LABEL = /^Speaker [1-9]\d*\s*:?\s*/u;

export interface MeetingPacePoint {
  /** Seconds from the start of the recording where this pace begins. */
  at: number;
  rate: number;
}

/**
 * A playback rate for each clocked turn, so a rush slows down and a sparse
 * stretch speeds up. The rate is how the turn's words-per-second compares
 * with the meeting's middle pace. No spread, or too few turns, is no pace.
 */
export function meetingPace(markdown: string): MeetingPacePoint[] | undefined {
  const turns: { at: number; wps: number }[] = [];
  for (const block of markdown.split(/\r?\n\s*\r?\n/u)) {
    const raw = block.trim();
    if (!raw || STRUCTURAL_LINE.test(raw)) continue;
    const match = CUE.exec(raw.replace(/\s*\n\s*/gu, " "));
    const start = clockSeconds(match?.[1]);
    const end = clockSeconds(match?.[2]);
    if (!match || start === undefined || end === undefined || end <= start)
      continue;
    const spoken = markdownPlainText(match[3] ?? "")
      .replace(SPEAKER_LABEL, "")
      .trim();
    const words = spoken.split(/\s+/u).filter(Boolean).length;
    if (!words) continue;
    turns.push({ at: start, wps: words / (end - start) });
  }
  if (turns.length < MIN_TURNS) return undefined;
  const byDensity = [...turns].sort((left, right) => left.wps - right.wps);
  const mid = Math.floor(byDensity.length / 2);
  const median =
    byDensity.length % 2 === 1
      ? byDensity[mid]?.wps
      : ((byDensity[mid - 1]?.wps ?? 0) + (byDensity[mid]?.wps ?? 0)) / 2;
  if (median === undefined || median <= 0) return undefined;
  const points = turns
    .map((turn) => ({
      at: turn.at,
      rate:
        Math.round(
          Math.min(FASTEST, Math.max(SLOWEST, median / turn.wps)) * 100,
        ) / 100,
    }))
    .sort((left, right) => left.at - right.at);
  const rates = new Set(points.map((point) => point.rate));
  return rates.size < 2 ? undefined : points;
}

/** The pace in effect at a moment, from the latest point that has started. */
export function paceAt(
  points: readonly MeetingPacePoint[],
  current: number,
): number | undefined {
  let rate: number | undefined;
  for (const point of points) {
    if (point.at > current) break;
    rate = point.rate;
  }
  return rate;
}

function clockSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.split(":");
  if (parts.some((part) => !/^\d+$/u.test(part))) return undefined;
  const numbers = parts.map(Number);
  if (numbers.length === 2) {
    const minutes = numbers[0];
    const seconds = numbers[1];
    if (minutes === undefined || seconds === undefined) return undefined;
    return minutes * 60 + seconds;
  }
  if (numbers.length === 3) {
    const hours = numbers[0];
    const minutes = numbers[1];
    const seconds = numbers[2];
    if (hours === undefined || minutes === undefined || seconds === undefined)
      return undefined;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return undefined;
}
