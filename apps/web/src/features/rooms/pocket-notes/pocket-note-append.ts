/**
 * Adds one block to the end of a Pocket Note page as its own paragraph. The
 * existing text stays as written, and an empty page gains no leading blank
 * line.
 */
export function appendToPocketNote(text: string, block: string): string {
  const addition = block.trim();
  if (!addition) return text;
  if (!text.trim()) return addition;
  const separator = text.endsWith("\n\n")
    ? ""
    : text.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${text}${separator}${addition}`;
}
