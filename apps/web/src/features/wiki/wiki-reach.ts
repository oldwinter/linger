import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";

/**
 * How `fromKey` reaches `toKey` when at least one page sits between them.
 * A direct link, the same page, or no chain is not a path to tell.
 */
export function wikiReach(
  nodes: ReadonlyMap<string, WikiGraphNode>,
  fromKey: string,
  toKey: string,
): WikiGraphNode[] | undefined {
  if (!fromKey || !toKey || fromKey === toKey) return;
  if (!nodes.has(fromKey) || !nodes.has(toKey)) return;
  const previous = new Map<string, string | null>();
  previous.set(fromKey, null);
  const queue = [fromKey];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current === toKey) break;
    for (const next of neighborIds(current, nodes)) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(toKey)) return;
  const keys: string[] = [];
  let cursor: string | null | undefined = toKey;
  while (cursor) {
    keys.push(cursor);
    const before = previous.get(cursor);
    if (before == null) break;
    cursor = before;
  }
  keys.reverse();
  if (keys.length < 3) return;
  return keys.flatMap((key) => {
    const node = nodes.get(key);
    return node ? [node] : [];
  });
}

/** The page key whose document route is `path`. */
export function pageKeyForHref(
  hrefs: ReadonlyMap<string, string>,
  path: string,
): string | undefined {
  for (const [key, href] of hrefs) {
    if (href === path) return key;
  }
  return;
}

function neighborIds(
  id: string,
  nodes: ReadonlyMap<string, WikiGraphNode>,
): string[] {
  const ids = new Set<string>();
  const node = nodes.get(id);
  if (node) {
    for (const link of node.links) ids.add(link);
    for (const link of node.backlinks) ids.add(link);
  }
  for (const other of nodes.values()) {
    if (other.links.includes(id) || other.backlinks.includes(id)) {
      ids.add(other.id);
    }
  }
  ids.delete(id);
  return [...ids].filter((item) => nodes.has(item));
}
