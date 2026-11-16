/**
 * Words still being said that continue the last line, or a separate line
 * when they do not.
 */
export interface WordsGrowingOnTheLine {
  aside?: string;
  growing?: string;
}

/**
 * Words that continue the last confirmed line grow on that line.
 * A sentence that does not continue it stays its own line, including one
 * that repeats the last line.
 */
export function wordsGrowingOnTheLine(
  partial: string | undefined,
  last: { text: string } | undefined,
): WordsGrowingOnTheLine {
  const text = partial?.trim();
  if (!text) return {};
  const confirmed = last?.text.trim();
  if (
    confirmed &&
    (text.startsWith(`${confirmed} `) || text.startsWith(`${confirmed}\n`))
  ) {
    const growing = text.slice(confirmed.length).trim();
    return growing ? { growing } : {};
  }
  return { aside: text };
}
