import { wikiCollectionLabels } from "./wiki-display-state";
import { wikiPreviewPages, type WikiPreviewPage } from "./wiki-preview-pages";

const excerptLimit = 240;

/** One page Another Me has written during the current Wiki refresh. */
export interface WikiWritingPage extends WikiPreviewPage {
  collectionLabel: string;
  excerpt: string;
}

/** Pages written so far, in name order, with the body under the title. */
export function wikiWritingPages(
  preview: Record<string, string> | undefined,
): WikiWritingPage[] {
  return wikiPreviewPages(preview).map((page) => ({
    ...page,
    collectionLabel: wikiCollectionLabels[page.collection],
    excerpt: wikiWritingExcerpt(page.markdown),
  }));
}

/** The first prose under the title, with the frontmatter left out. */
export function wikiWritingExcerpt(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "");
  const text = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > excerptLimit ? `${text.slice(0, excerptLimit)}…` : text;
}
