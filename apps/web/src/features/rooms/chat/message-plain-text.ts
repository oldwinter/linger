import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

/**
 * One Message's body as the reader sees it. Copy text and Copy as quote both
 * start here, so the two clipboard texts can only differ by the quote markers.
 */
export function messageBodyText(message: string): string {
  return markdownPlainText(message);
}

/**
 * The clipboard text for Copy text: the body with one final newline, so it
 * pastes as its own block and never carries trailing blank lines.
 */
export function messagePlainText(message: string): string {
  const body = messageBodyText(message).trimEnd();
  return body ? `${body}\n` : "";
}
