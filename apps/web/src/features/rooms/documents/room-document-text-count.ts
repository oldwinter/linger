import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

export interface RoomDocumentTextCount {
  /** Non-whitespace code points, so an emoji counts once. */
  characters: number;
  /** Runs of non-whitespace, so punctuation alone still counts as a word. */
  words: number;
}

const whitespace = /\s/u;

/**
 * Counts the readable text of a Document's Markdown export. Markdown syntax is
 * removed first, so code fences, list markers and emphasis markers are never
 * counted and a code block contributes its content once.
 */
export function countRoomDocumentText(markdown: string): RoomDocumentTextCount {
  const text = markdownPlainText(markdown);
  let characters = 0;
  for (const character of text) {
    if (!whitespace.test(character)) characters += 1;
  }
  return { characters, words: text.match(/\S+/gu)?.length ?? 0 };
}

/** The compact line the editor shows under an editable Document. */
export function roomDocumentTextCountLabel(
  count: RoomDocumentTextCount,
): string {
  return `${quantity(count.words, "word")} · ${quantity(count.characters, "character")}`;
}

function quantity(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}
