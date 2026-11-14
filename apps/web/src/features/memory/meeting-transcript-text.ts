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
  return markdown
    .split(/\r?\n\s*\r?\n/u)
    .map(turnText)
    .filter((line): line is string => line !== null)
    .join("\n");
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
