/**
 * A sentence that has already finished inside words that are still being said,
 * and the words that have not finished yet.
 */
export interface SentencesStillBeingSaid {
  said: string[];
  saying: string | undefined;
}

/**
 * A finished sentence stays, and the words after it are still being said.
 * A sentence already confirmed is not said again.
 */
export function sentencesStillBeingSaid(
  partial: string | undefined,
  confirmed: readonly { text: string }[],
): SentencesStillBeingSaid {
  const text = partial?.trim();
  if (!text) return { said: [], saying: undefined };
  const confirmedText = new Set(
    confirmed.map((item) => item.text.trim()).filter(Boolean),
  );
  const said: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const mark = text[index];
    if (mark !== "." && mark !== "!" && mark !== "?") continue;
    const next = text[index + 1];
    if (next !== " " && next !== "\n") continue;
    const sentence = text.slice(start, index + 1).trim();
    if (sentence && !confirmedText.has(sentence)) said.push(sentence);
    start = index + 1;
  }
  if (start === 0) return { said: [], saying: text };
  const saying = text.slice(start).trim();
  return { said, saying: saying || undefined };
}
