import {
  pageTitle,
  type WikiGraphData,
  type WikiGraphNode,
} from "./wiki-graph-model";

export interface GraphNeighborhood {
  also: WikiGraphNode[];
  center: WikiGraphNode;
  links: WikiGraphNode[];
  mentionedBy: WikiGraphNode[];
}

const alsoLimit = 5;

/** The best page for a search, and the pages the graph ties to it. */
export function graphNeighborhood(
  graph: WikiGraphData,
  query: string,
): GraphNeighborhood | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return;
  const matches = graph.nodes
    .filter((node) =>
      [node.title, node.description, ...node.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
    .sort(
      (left, right) =>
        titleRank(left, needle) - titleRank(right, needle) ||
        pageTitle(left).localeCompare(pageTitle(right)),
    );
  const center = matches[0];
  if (!center) return;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return {
    also: matches.slice(1, alsoLimit + 1),
    center,
    links: related(center.id, center.links, graph, byId, "out"),
    mentionedBy: related(center.id, center.backlinks, graph, byId, "in"),
  };
}

function titleRank(node: WikiGraphNode, needle: string): number {
  const title = node.title.toLowerCase();
  if (title === needle) return 0;
  if (title.startsWith(needle)) return 1;
  if (title.includes(needle)) return 2;
  return 3;
}

function related(
  centerId: string,
  listed: readonly string[],
  graph: WikiGraphData,
  byId: Map<string, WikiGraphNode>,
  direction: "in" | "out",
): WikiGraphNode[] {
  const ids = new Set(listed);
  for (const edge of graph.edges) {
    const other =
      direction === "out"
        ? edge.source === centerId
          ? edge.target
          : undefined
        : edge.target === centerId
          ? edge.source
          : undefined;
    if (other && other !== centerId) ids.add(other);
  }
  return [...ids]
    .flatMap((id) => {
      const node = byId.get(id);
      return node && node.id !== centerId ? [node] : [];
    })
    .sort((left, right) => pageTitle(left).localeCompare(pageTitle(right)));
}
