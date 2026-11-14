/**
 * How today's page looks pasted into another document: the text the page
 * shows, with trailing whitespace reduced to one closing newline. Empty when
 * nothing is written, so the Copy action knows there is nothing to take.
 */
export function pocketNoteCopyText(text: string): string {
  const body = text.replace(/\s+$/u, "");
  return body ? `${body}\n` : "";
}
