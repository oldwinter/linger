import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

const TURN_CUE =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?\]\s*/u;
const SPEAKER_LABEL = /^(Speaker [1-9]\d*)\s*:?\s*/u;
const STRUCTURAL_LINE = /^(?:#{1,6}(?:\s|$)|>)/u;

/** One spoken line copied out of a meeting. */
export interface MeetingCopiedLine {
  /** Who said it, when the transcript named a speaker. */
  speaker?: string;
  /** The cue's opening clock, as written. */
  startLabel: string;
  startSeconds: number;
  text: string;
}

/**
 * The transcript's spoken lines, each still tied to who said it and where
 * the recording was. A heading or a turn with no clock is not a line.
 */
export function meetingCopiedLines(markdown: string): MeetingCopiedLine[] {
  const lines: MeetingCopiedLine[] = [];
  for (const block of markdown.split(/\r?\n\s*\r?\n/u)) {
    if (STRUCTURAL_LINE.test(block.trimStart())) continue;
    const text = markdownPlainText(block)
      .replace(/\s*\n\s*/gu, " ")
      .trim();
    const cue = TURN_CUE.exec(text);
    const startLabel = cue?.[1];
    if (!startLabel) continue;
    const startSeconds = clockSeconds(startLabel);
    if (startSeconds === undefined) continue;
    const body = text.slice(cue[0].length).trim();
    const speaker = SPEAKER_LABEL.exec(body);
    const spoken = speaker ? body.slice(speaker[0].length).trim() : body;
    if (!spoken) continue;
    lines.push({
      ...(speaker?.[1] ? { speaker: speaker[1] } : {}),
      startLabel,
      startSeconds,
      text: spoken,
    });
  }
  return lines;
}

/**
 * The one line a selection sits inside. A selection that spans lines, or
 * that matches more than one, is left for the browser's own copy.
 */
export function copiedMeetingLine(
  lines: readonly MeetingCopiedLine[],
  selection: string,
): MeetingCopiedLine | undefined {
  const needle = selection.replace(/\s+/gu, " ").trim();
  if (!needle) return;
  const hits = lines.filter((line) =>
    lineForms(line).some((form) => form.includes(needle)),
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/** The copied line, with who said it, where it was, and how to open it. */
export function copiedMeetingLineText(
  line: MeetingCopiedLine,
  openUrl: string,
): string {
  const who = line.speaker
    ? `${line.speaker}, ${line.startLabel}`
    : line.startLabel;
  return `${who}\n${line.text}\n${openUrl}`;
}

/** Seconds from a copied line's `at` query, or nothing when it is not one. */
export function meetingStartAt(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return;
  return Number(value);
}

export function meetingLineOpenUrl(
  meetingUrl: string,
  startSeconds: number,
): string {
  const url = new URL(meetingUrl, "http://meetings.invalid");
  url.searchParams.set("file", "summary");
  url.searchParams.set("at", String(startSeconds));
  return `${url.pathname}${url.search}`;
}

function lineForms(line: MeetingCopiedLine): string[] {
  const spoken = line.speaker ? `${line.speaker}: ${line.text}` : line.text;
  const cued = line.speaker
    ? `[${line.startLabel}] ${line.speaker}: ${line.text}`
    : `[${line.startLabel}] ${line.text}`;
  return [line.text, spoken, cued].map((form) =>
    form.replace(/\s+/gu, " ").trim(),
  );
}

function clockSeconds(clock: string): number | undefined {
  const parts = clock.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part))) return;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (minutes === undefined || seconds === undefined || seconds > 59) return;
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    if (
      hours === undefined ||
      minutes === undefined ||
      seconds === undefined ||
      minutes > 59 ||
      seconds > 59
    ) {
      return;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }
  return;
}
