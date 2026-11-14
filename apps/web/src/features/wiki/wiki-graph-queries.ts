import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  parseEmbeddedWikiGraph,
  type WikiGraphNode,
} from "@/features/memory/wiki-graph-model";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

/** Graph nodes by Wiki page key; descriptions and links feed the cards. */
export function useWikiGraphNodes(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const graph = useQuery({
    queryFn: () => client.getPersonalKnowledgeGraphVisualization(tenantId),
    queryKey: ["teamhub", tenantId, "personal-wiki", "graph"],
    retry: false,
  });
  return useMemo(
    () =>
      new Map<string, WikiGraphNode>(
        (graph.data ? parseEmbeddedWikiGraph(graph.data)?.nodes : [])?.map(
          (node) => [node.id, node],
        ),
      ),
    [graph.data],
  );
}
