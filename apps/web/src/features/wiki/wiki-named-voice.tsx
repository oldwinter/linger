import { useMemo } from "react";

import { filterWikiGraph, useWikiDisplayState } from "./wiki-display-state";
import { useWikiGraph } from "./wiki-graph-queries";
import { wikiNamedSentence } from "./wiki-named-sentence";

/**
 * The sentence of the one page this page names and does not link to.
 * It is part of the reading, not a link to that page.
 */
export function WikiNamedSentence({
  pageKey,
  tenantId,
}: {
  pageKey: string;
  tenantId: string;
}) {
  const graph = useWikiGraph(tenantId);
  const display = useWikiDisplayState(tenantId);
  const sentence = useMemo(() => {
    if (!graph) return undefined;
    return wikiNamedSentence(
      pageKey,
      filterWikiGraph(graph, display.decisions),
    );
  }, [display.decisions, graph, pageKey]);
  if (!sentence) return null;
  return (
    <p className="room-document-layout room-document-layout--knowledge mx-auto mt-8 text-[15px] leading-7 text-app-ink">
      {sentence}
    </p>
  );
}
