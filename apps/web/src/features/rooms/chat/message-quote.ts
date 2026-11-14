import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

const unknownAuthor = "Unknown author";

/** The author a quote names, so the quote and the composer's reply strip agree. */
export function messageQuoteAuthor(authorName?: string | null) {
  return authorName?.trim() || unknownAuthor;
}

/**
 * The clipboard block for one Message: its author and local time, then the
 * readable text quoted line by line. Every line carries a `>` marker, so the
 * whole thing stays one Markdown blockquote when pasted.
 */
export function messageQuoteText(input: {
  /** The name the row shows for the author; absent when nobody knows it. */
  authorName?: string | null;
  createdAt: string;
  message: string;
}) {
  const author = messageQuoteAuthor(input.authorName);
  const body = markdownPlainText(input.message);
  const head = `> ${author}, ${messageQuoteTime(input.createdAt)}`;
  if (!body) return head;
  const quoted = body
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"));
  return [head, ">", ...quoted].join("\n");
}

/** `YYYY-MM-DD HH:mm` in the reader's time zone, so a quote reads as a date. */
function messageQuoteTime(timestamp: string) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
