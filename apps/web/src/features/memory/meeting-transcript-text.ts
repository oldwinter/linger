import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

/**
 * The transcript Version is Markdown with one blank-line-separated paragraph
 * per turn. A turn opens with a bracketed time cue and, when diarization named
 * its speaker, the renderer's fixed `Speaker N` label; the document also
 * carries a heading and a missing-audio notice. Copies keep the turns and drop
 * the rest, so a pasted transcript reads as `Speaker N: text` lines.
 */
const TURN_CUE = /^\[[^\]]*\]\s*/u;
const SPEAKER_LABEL = /^(Speaker [1-9]\d*)\s*:?\s*/u;
const STRUCTURAL_LINE = /^(?:#{1,6}(?:\s|$)|>)/u;
const CUE_CLOCK =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/u;
/** A shorter gap stays part of the same stretch of their talking. */
const PASS_SECONDS = 60;

/**
 * Plain text of a meeting transcript: one line per turn, in the order it was
 * spoken. Turns without a speaker label keep the text alone, as the recording's
 * renderer writes them when diarization is unavailable.
 */
export function meetingTranscriptText(markdown: string): string {
  return meetingTranscriptTurns(markdown).join("\n");
}

/** The transcript's turns alone, in spoken order, without the cues between them. */
export function meetingTranscriptTurns(markdown: string): string[] {
  return markdown
    .split(/\r?\n\s*\r?\n/u)
    .map(turnText)
    .filter((line): line is string => line !== null);
}

export interface TranscriptCue {
  start: number;
  end: number;
}

/**
 * One clock per turn, in the same order as `meetingTranscriptTurns`. A turn
 * with no bracketed range keeps an empty slot so the lists stay aligned.
 */
export function meetingTranscriptCues(
  markdown: string,
): (TranscriptCue | undefined)[] {
  return markdown.split(/\r?\n\s*\r?\n/u).flatMap((block) => {
    if (turnText(block) === null) return [];
    return [cueRange(block)];
  });
}

function cueRange(block: string): TranscriptCue | undefined {
  const text = markdownPlainText(block)
    .replace(/\s*\n\s*/gu, " ")
    .trim();
  const match = CUE_CLOCK.exec(text);
  const startClock = match?.[1];
  const endClock = match?.[2];
  if (!startClock || !endClock) return;
  const start = clockSeconds(startClock);
  const end = clockSeconds(endClock);
  if (start === undefined || end === undefined || end < start) return;
  return { start, end };
}

/** The turn being spoken at `time`, staying on it through the gap before the next. */
export function spokenTurnIndex(
  cues: readonly (TranscriptCue | undefined)[],
  time: number,
): number | undefined {
  if (!Number.isFinite(time) || time < 0) return;
  let current: number | undefined;
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue || cue.start > time) continue;
    current = index;
  }
  return current;
}

export interface SpeakerPartLine {
  kind: "passed" | "said";
  text: string;
}

interface SpokenTurn {
  end?: number;
  speaker?: string;
  start?: number;
  text: string;
}

/** Speakers in the order they first speak. A meeting of one voice has one. */
export function meetingSpeakers(markdown: string): string[] {
  const speakers: string[] = [];
  for (const turn of spokenTurns(markdown)) {
    if (turn.speaker && !speakers.includes(turn.speaker)) {
      speakers.push(turn.speaker);
    }
  }
  return speakers;
}

/**
 * One speaker's words, in the order they said them. A minute or more before
 * they speak again is named; a shorter gap is not.
 */
export function meetingSpeakerPart(
  markdown: string,
  speaker: string,
): SpeakerPartLine[] {
  const lines: SpeakerPartLine[] = [];
  let previousEnd: number | undefined;
  for (const turn of spokenTurns(markdown)) {
    if (turn.speaker !== speaker) continue;
    if (previousEnd !== undefined && turn.start !== undefined) {
      const passed = passedWords(turn.start - previousEnd);
      if (passed) lines.push({ kind: "passed", text: passed });
    }
    lines.push({ kind: "said", text: turn.text });
    previousEnd = turn.end;
  }
  return lines;
}

/** Plain text of one speaker's part, blank line between each piece. */
export function meetingSpeakerPartText(
  lines: readonly SpeakerPartLine[],
): string {
  return lines.map((line) => line.text).join("\n\n");
}

function spokenTurns(markdown: string): SpokenTurn[] {
  return markdown.split(/\r?\n\s*\r?\n/u).flatMap((block) => {
    const turn = parsedTurn(block);
    return turn ? [turn] : [];
  });
}

function parsedTurn(block: string): SpokenTurn | null {
  if (STRUCTURAL_LINE.test(block.trimStart())) return null;
  // The same line-based Markdown stripper the app's previews use; a turn that
  // wrapped across source lines joins back into one line.
  const text = markdownPlainText(block)
    .replace(/\s*\n\s*/gu, " ")
    .trim();
  const cue = CUE_CLOCK.exec(text);
  const startClock = cue?.[1];
  const endClock = cue?.[2];
  const start = startClock ? clockSeconds(startClock) : undefined;
  const end = endClock ? clockSeconds(endClock) : undefined;
  const clocks =
    start !== undefined && end !== undefined && end >= start
      ? { end, start }
      : {};
  const body = text.replace(TURN_CUE, "");
  const speaker = SPEAKER_LABEL.exec(body);
  const label = speaker?.[1];
  if (!label) return body ? { text: body, ...clocks } : null;
  const spoken = body.slice(speaker[0].length).trim();
  return spoken ? { speaker: label, text: spoken, ...clocks } : null;
}

function turnText(block: string): string | null {
  const turn = parsedTurn(block);
  if (!turn) return null;
  return turn.speaker ? `${turn.speaker}: ${turn.text}` : turn.text;
}

function passedWords(gapSeconds: number): string | undefined {
  if (!Number.isFinite(gapSeconds) || gapSeconds < PASS_SECONDS) return;
  const minutes = Math.round(gapSeconds / 60);
  if (minutes < 120) {
    return minutes === 1 ? "1 minute passed" : `${minutes} minutes passed`;
  }
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour passed" : `${hours} hours passed`;
}

function clockSeconds(clock: string): number | undefined {
  const parts = clock.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return;
  const hours = parts.length === 3 ? parts[0] : 0;
  const minutes = parts.length === 3 ? parts[1] : parts[0];
  const seconds = parts.length === 3 ? parts[2] : parts[1];
  if (
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined ||
    parts.length < 2 ||
    parts.length > 3
  ) {
    return;
  }
  return hours * 3600 + minutes * 60 + seconds;
}
