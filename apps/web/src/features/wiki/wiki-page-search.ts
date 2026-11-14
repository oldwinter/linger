/**
 * How much raw Markdown a page contributes to one search. A page beyond this
 * length is still findable by name or description, but its tail is not scanned.
 */
export const WIKI_SEARCH_BODY_LIMIT = 16_384;

/** Characters kept on each side of a body match in the shown snippet. */
const SNIPPET_RADIUS = 60;

export interface WikiSearchPage {
  /** The page body after `wikiSearchText`, not raw Markdown. */
  body: string;
  description: string;
  title: string;
}

export interface WikiSearchMatch {
  /** Set only when the body matched, so a name match keeps its description. */
  snippet?: string;
}

/**
 * Matches a Wiki page name, description, or body, case-insensitively. Name and
 * description win over the body; a body-only match returns one bounded snippet
 * around the first hit.
 */
export function matchWikiPage(
  page: WikiSearchPage,
  query: string,
): WikiSearchMatch | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  if (`${page.title} ${page.description}`.toLowerCase().includes(needle))
    return {};
  const index = page.body.toLowerCase().indexOf(needle);
  if (index === -1) return undefined;
  return { snippet: snippetAround(page.body, index, needle.length) };
}

/**
 * Reduces Markdown to the words a reader sees, capped so a large page never
 * slows a keystroke. The cap applies to the raw text first because stripping
 * is the expensive part.
 */
export function wikiSearchText(markdown: string): string {
  const source = markdown.slice(0, WIKI_SEARCH_BODY_LIMIT);
  return source
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, " ")
    .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gmu, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gmu, " ")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d{1,3}[.)])[ \t]+/gmu, "")
    .replace(/(\*\*|__|~~|\*)/gu, "")
    .replace(/\|/gu, " ")
    .replace(/`/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
