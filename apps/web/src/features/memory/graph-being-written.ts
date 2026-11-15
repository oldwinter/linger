import type { WikiPreviewPage } from "@/features/wiki/wiki-preview-pages";

import type { WikiGraphData, WikiGraphNode } from "./wiki-graph-model";

const SESSION_DAY = /^sessions\/(\d{4}-\d{2}-\d{2})\//u;

/** A page the refresh has written, and the published pages it names. */
export interface ArrivingGraphPage {
  /** Set when the path is a dated session, so the timeline can count it. */
  day?: string;
  links: string[];
  name: string;
}

/**
 * Puts pages that are still being written onto the graph. A dated session
 * lands on its day. Any other page is there to be found and to show the
 * published pages it names. A page the published graph already has is left
 * alone.
 */
export function graphWithPagesBeingWritten(
  graph: WikiGraphData,
  pages: readonly WikiPreviewPage[],
): { arrived: ArrivingGraphPage[]; graph: WikiGraphData } {
  const known = new Set(graph.nodes.map((node) => node.id));
  const arrived: ArrivingGraphPage[] = [];
  const nodes = graph.nodes.map((node) => ({
    ...node,
    backlinks: [...node.backlinks],
    links: [...node.links],
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = [...graph.edges];
  for (const page of pages) {
    if (known.has(page.path)) continue;
    const day = SESSION_DAY.exec(page.path)?.[1];
    const links = linkedNodeIds(page.markdown, nodes);
    const node: WikiGraphNode = {
      backlinks: [],
      body: "",
      category: "sessions",
      description: page.description,
      id: page.path,
      links,
      size: 1,
      tags: [],
      title: page.name,
    };
    nodes.push(node);
    byId.set(node.id, node);
    known.add(node.id);
    for (const target of links) {
      edges.push({ source: node.id, target });
      const linked = byId.get(target);
      if (linked && !linked.backlinks.includes(node.id)) {
        linked.backlinks.push(node.id);
      }
    }
    arrived.push({
      ...(day ? { day } : {}),
      links,
      name: page.name,
    });
  }
  return { arrived, graph: { ...graph, edges, nodes } };
}

function linkedNodeIds(markdown: string, nodes: readonly WikiGraphNode[]) {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.id.startsWith("sessions/")) continue;
    const named =
      markdown.includes(`[[${node.title}]]`) || markdown.includes(node.id);
    if (named) ids.push(node.id);
  }
  return ids;
}
