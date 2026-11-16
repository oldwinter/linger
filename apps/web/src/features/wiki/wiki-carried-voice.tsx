import { useMemo } from "react";

import { filterWikiGraph, useWikiDisplayState } from "./wiki-display-state";
import { wikiCarriedSentence } from "./wiki-carried-sentence";
import { useWikiGraph } from "./wiki-graph-queries";

/**
 * The sentence after a line this page shares with one other page.
 * The shared line is already on the page, so only what follows is carried.
 */
export function WikiCarriedSentence({
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
    return wikiCarriedSentence(
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
