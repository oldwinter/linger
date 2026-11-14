import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

/**
 * How much of the page travels with its link. Enough to tell what the page is
 * about, bounded so a long page cannot flood a Room.
 */
export const WIKI_PAGE_EXCERPT_LIMIT = 280;

export interface WikiPageShare {
  /** The Room Message: the page title, its excerpt, and the link back. */
  text: string;
  /** Changes when the page itself changes. */
  version: string;
}

/**
 * Reads a Wiki page as the Room Message Send to Room posts: a heading with the
 * title, the plain text the page opens with, and its absolute link.
 */
export function wikiPageShare({
  documentId,
  markdown,
  title,
  updatedAt,
  url,
}: {
  documentId: string;
  markdown: string;
  title: string;
  updatedAt: string;
  url: string;
}): WikiPageShare {
  const excerpt = wikiPageExcerpt(markdown);
  return {
    text: [`# ${title.trim()}`, ...(excerpt ? [excerpt] : []), url].join(
      "\n\n",
    ),
    version: sanitized(`${documentId}:${updatedAt}`),
  };
}

/**
 * The page's opening plain text, cut at a word boundary at most
 * `WIKI_PAGE_EXCERPT_LIMIT` characters in and closed with an ellipsis, which
 * says the page continues. A page that fits is returned whole.
 */
export function wikiPageExcerpt(markdown: string): string {
  const text = markdownPlainText(markdown).replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  if (characters.length <= WIKI_PAGE_EXCERPT_LIMIT) return text;
  const head = characters.slice(0, WIKI_PAGE_EXCERPT_LIMIT);
  const lastSpace = head.lastIndexOf(" ");
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head)
    .join("")
    .replace(/[\s.,;:!?…-]+$/u, "")}…`;
}

/** One Room Message per page revision and Room: retrying the same send
 * replays the first Message, while another Room gets its own key. */
export function wikiPageShareIdempotencyKey(version: string, roomId: string) {
  return sanitized(`wiki-page-share:${version}:${roomId}`).slice(0, 128);
}

function sanitized(part: string) {
  return part.replace(/[^A-Za-z0-9._:-]/gu, "-");
}
