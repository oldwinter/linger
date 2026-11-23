import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  parseEmbeddedWikiGraph,
  type WikiGraphData,
  type WikiGraphNode,
} from "@/features/memory/wiki-graph-model";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

/** The published graph, when the visualization has been read. */
export function useWikiGraph(
  tenantId: string,
  enabled = true,
): WikiGraphData | undefined {
  const { client } = useTeamHubRuntime();
  const graph = useQuery({
    enabled,
    queryFn: () => client.getPersonalKnowledgeGraphVisualization(tenantId),
    queryKey: ["teamhub", tenantId, "personal-wiki", "graph"],
    retry: false,
  });
  return useMemo(
    () => (graph.data ? parseEmbeddedWikiGraph(graph.data) : undefined),
    [graph.data],
  );
}

/** Graph nodes by Wiki page key; descriptions and links feed the cards. */
export function useWikiGraphNodes(tenantId: string, enabled = true) {
  const graph = useWikiGraph(tenantId, enabled);
  return useMemo(
    () =>
      new Map<string, WikiGraphNode>(
        graph?.nodes.map((node) => [node.id, node]),
      ),
    [graph],
  );
}
