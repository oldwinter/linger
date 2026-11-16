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

const CUE_CLOCK =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/u;

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

function clockSeconds(clock: string): number | undefined {
  const parts = clock.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return;
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

function turnText(block: string): string | null {
  if (STRUCTURAL_LINE.test(block.trimStart())) return null;
  // The same line-based Markdown stripper the app's previews use; a turn that
  // wrapped across source lines joins back into one line.
  const text = markdownPlainText(block)
    .replace(/\s*\n\s*/gu, " ")
    .trim();
  const body = text.replace(TURN_CUE, "");
  const speaker = SPEAKER_LABEL.exec(body);
  if (!speaker) return body || null;
  const spoken = body.slice(speaker[0].length).trim();
  return spoken ? `${speaker[1]}: ${spoken}` : null;
}
