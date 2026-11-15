import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";

/**
 * The one page that links this one and is linked back, when it has words.
 * Several such pages are not a pair, so none of them is chosen.
 */
export function mutualPage(
  pageKey: string,
  nodes: ReadonlyMap<string, WikiGraphNode>,
): WikiGraphNode | undefined {
  const node = nodes.get(pageKey);
  if (!node) return;
  const partners: WikiGraphNode[] = [];
  const seen = new Set<string>();
  for (const id of node.links) {
    if (seen.has(id)) continue;
    seen.add(id);
    const other = nodes.get(id);
    if (!other || other.id === node.id) continue;
    if (!other.links.includes(node.id)) continue;
    if (!other.body.trim()) continue;
    partners.push(other);
  }
  return partners.length === 1 ? partners[0] : undefined;
}
