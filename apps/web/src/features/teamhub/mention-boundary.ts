/**
 * Whether a Mention or Skill token may start at `index` in `text`.
 *
 * A token starts at the beginning, after whitespace or punctuation, and after a
 * character of a script that writes words without spaces, which is why an
 * at-sign straight after a Han character is a Mention. A letter, a combining
 * mark or a number of a script that separates words with spaces keeps the token
 * literal, so `иван@почта.рф`, `αβ@`, `الي@`, a pasted `cafe` + U+0301 + `@` and
 * `alice@example` stay plain text. A path or address character (`_`, `@`, `/`)
 * keeps it literal everywhere.
 *
 * Script_Extensions rather than Script: a Japanese word can end in the
 * prolonged sound mark U+30FC or a half-width U+FF70, both Script=Common, and a
 * decomposed voiced mark is Script_Extensions=Hira. The list is a hand-picked
 * set of the unspaced scripts this product ships in; Lao, Khmer, Myanmar and
 * Tibetan are not covered and behave like a spaced script.
 */
const UNSPACED_SCRIPT =
  /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_@/]/u;

export function startsMentionToken(text: string, index: number): boolean {
  if (index <= 0) return true;
  // Read the one code point before the token in O(1): when the unit at
  // index - 1 is a low surrogate, the character starts one unit earlier.
  const last = text.charCodeAt(index - 1);
  const at =
    last >= 0xdc00 && last <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  const previous = String.fromCodePoint(text.codePointAt(at)!);
  if (!WORD_CHARACTER.test(previous)) return true;
  return UNSPACED_SCRIPT.test(previous);
}
