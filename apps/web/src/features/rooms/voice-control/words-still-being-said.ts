import type { VoiceTranscriptItem } from "./voice-control-context";

/**
 * The words still being said, after any confirmed line they repeat.
 * An empty remainder means the hypothesis has already been said.
 */
export function wordsStillBeingSaid(
  partial: string | undefined,
  confirmed: readonly Pick<VoiceTranscriptItem, "text">[],
): string | undefined {
  const text = partial?.trim();
  if (!text) return;
  const last = confirmed.at(-1)?.text.trim();
  // A sentence said again is still being said. Only a hypothesis that
  // continues the last confirmed line drops the words already on the page.
  if (!last || text === last) return text;
  if (text.startsWith(`${last} `) || text.startsWith(`${last}\n`)) {
    const rest = text.slice(last.length).trim();
    return rest || undefined;
  }
  return text;
}

/**
 * While a recording is saving, the words that were still being said stay
 * until a confirmed line covers them.
 */
export function unfinishedWhileSaving(
  saying: string | undefined,
  confirmedCount: number,
  held: { count: number; text: string } | undefined,
  saving: boolean,
): string | undefined {
  if (saying) return saying;
  if (!saving || !held || confirmedCount !== held.count) return;
  return held.text;
}
