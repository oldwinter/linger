import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";

import { documentSourceMessages as m } from "./document-sources.messages";

type DocumentSource = Pick<
  TeamHubDocument["from"][number],
  "binding_kind" | "label"
>;

/**
 * The name of one place a Document is visible in. Room and Work Item names
 * are data and stay as TeamHub sends them; the Personal Wiki has no name of
 * its own, so it is worded from the binding kind in the interface language.
 * Undefined when TeamHub sent no name.
 */
export function documentSourceLabel(
  source: DocumentSource,
  t: Translate,
): string | undefined {
  if (isWikiSource(source)) return t(m.personalWiki);
  return source.label;
}

/**
 * The names of every place a Document is visible in. A Wiki page and its
 * source file both read as the Personal Wiki, which is listed once; Rooms
 * that share a name are still listed each time.
 */
export function documentSourceLabels<Source extends DocumentSource>(
  sources: readonly Source[],
  t: Translate,
  fallback: (source: Source) => string,
): string[] {
  let wikiListed = false;
  return sources.flatMap((source) => {
    if (isWikiSource(source)) {
      if (wikiListed) return [];
      wikiListed = true;
    }
    return [documentSourceLabel(source, t) ?? fallback(source)];
  });
}

function isWikiSource(source: DocumentSource) {
  return (
    source.binding_kind === "wiki_page" || source.binding_kind === "wiki_source"
  );
}
