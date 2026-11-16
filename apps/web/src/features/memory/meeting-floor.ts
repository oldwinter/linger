import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

const STRUCTURAL_LINE = /^(?:#{1,6}(?:\s|$)|>)/u;
const TURN_CUE = /^\[[^\]]*\]\s*/u;
const SPEAKER_LABEL = /^(Speaker [1-9]\d*)\s*:?\s*/u;
const CUE_CLOCK =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/u;
/** A gap shorter than this stays part of the turn beside it. */
const QUIET_GAP_SECONDS = 1;

export interface FloorSegment {
  end: number;
  kind: "quiet" | "spoke";
  speaker?: string;
  start: number;
}

export interface FloorShare {
  seconds: number;
  speaker: string;
}

/** Who held the floor, from the first clocked word to the last. */
export interface MeetingFloor {
  quietSeconds: number;
  segments: FloorSegment[];
  shares: FloorShare[];
  /** Seconds from the first word to the last. */
  span: number;
}

interface ClockedTurn {
  end: number;
  speaker: string;
  start: number;
}

/**
 * The meeting as time held by each voice, including the quiet between them.
 * One voice, or a transcript without clocks, has no floor to show.
 */
export function meetingFloor(markdown: string): MeetingFloor | undefined {
  const turns = clockedTurns(markdown);
  const speakers = new Set(turns.map((turn) => turn.speaker));
  if (speakers.size < 2) return;
  const first = turns[0];
  if (!first) return;
  const segments: FloorSegment[] = [];
  const shareSeconds = new Map<string, number>();
  const order: string[] = [];
  let cursor = first.start;
  let quietSeconds = 0;
  for (const turn of turns) {
    let start = turn.start;
    const end = turn.end;
    if (end <= cursor) continue;
    if (start < cursor) start = cursor;
    if (start - cursor >= QUIET_GAP_SECONDS) {
      segments.push({ end: start, kind: "quiet", start: cursor });
      quietSeconds += start - cursor;
    }
    const spoken = end - start;
    if (spoken <= 0) continue;
    segments.push({
      end,
      kind: "spoke",
      speaker: turn.speaker,
      start,
    });
    if (!shareSeconds.has(turn.speaker)) order.push(turn.speaker);
    shareSeconds.set(
      turn.speaker,
      (shareSeconds.get(turn.speaker) ?? 0) + spoken,
    );
    cursor = end;
  }
  const span = cursor - first.start;
  if (span <= 0 || order.length < 2) return;
  return {
    quietSeconds,
    segments,
    shares: order.flatMap((speaker) => {
      const seconds = shareSeconds.get(speaker);
      return seconds ? [{ seconds, speaker }] : [];
    }),
    span,
  };
}

/** One sentence for the strip: each voice, then a long quiet if there was one. */
export function floorSentence(floor: MeetingFloor): string {
  const voices = floor.shares.map(
    (share) => `${share.speaker} spoke for ${durationWords(share.seconds)}.`,
  );
  if (floor.quietSeconds >= 60) {
    voices.push(`The room was quiet for ${durationWords(floor.quietSeconds)}.`);
  }
  return voices.join(" ");
}

function clockedTurns(markdown: string): ClockedTurn[] {
  return markdown.split(/\r?\n\s*\r?\n/u).flatMap((block) => {
    const turn = clockedTurn(block);
    return turn ? [turn] : [];
  });
}

function clockedTurn(block: string): ClockedTurn | undefined {
  if (STRUCTURAL_LINE.test(block.trimStart())) return;
  const text = markdownPlainText(block)
    .replace(/\s*\n\s*/gu, " ")
    .trim();
  const cue = CUE_CLOCK.exec(text);
  const start = cue?.[1] ? clockSeconds(cue[1]) : undefined;
  const end = cue?.[2] ? clockSeconds(cue[2]) : undefined;
  if (start === undefined || end === undefined || end < start) return;
  const body = text.replace(TURN_CUE, "");
  const speaker = SPEAKER_LABEL.exec(body);
  const label = speaker?.[1];
  if (!label) return;
  const spoken = body.slice(speaker[0].length).trim();
  if (!spoken) return;
  return { end, speaker: label, start };
}

function durationWords(seconds: number): string {
  if (seconds < 60) {
    const whole = Math.max(1, Math.round(seconds));
    return whole === 1 ? "1 second" : `${whole} seconds`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 120) {
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  const hours = Math.max(1, Math.round(minutes / 60));
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function clockSeconds(clock: string): number | undefined {
  const parts = clock.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return;
  if (parts.length !== 2 && parts.length !== 3) return;
  const hours = parts.length === 3 ? parts[0] : 0;
  const minutes = parts.length === 3 ? parts[1] : parts[0];
  const seconds = parts.length === 3 ? parts[2] : parts[1];
  if (hours === undefined || minutes === undefined || seconds === undefined) {
    return;
  }
  return hours * 3600 + minutes * 60 + seconds;
}
