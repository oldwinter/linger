import { useEffect, useRef, useState } from "react";

import type { WikiPreviewPage } from "./wiki-preview-pages";

const excerptLimit = 240;

/** The prose under a written page's title. */
export function wikiPageExcerpt(markdown: string): string {
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

/**
 * The page to feature while Another Me is writing. The first snapshot features
 * the last page already written; a page that appears later replaces it.
 */
export function useWikiLiveFocus(
  pages: readonly WikiPreviewPage[],
): WikiPreviewPage | undefined {
  const known = useRef(new Set<string>());
  const [featuredKey, setFeaturedKey] = useState<string | undefined>();

  useEffect(() => {
    const arrived = pages.filter((page) => !known.current.has(page.key));
    for (const page of pages) known.current.add(page.key);
    const newest = arrived.at(-1);
    if (newest) setFeaturedKey(newest.key);
  }, [pages]);

  return pages.find((page) => page.key === featuredKey) ?? pages.at(-1);
}
