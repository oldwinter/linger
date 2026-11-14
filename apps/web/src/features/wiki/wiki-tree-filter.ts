import type { WikiTreeNode } from "./wiki-tree";

/** The Wiki tree narrowed to a query, plus what the sidebar needs to show it. */
export interface WikiTreeFilter {
  /** Titles that matched, pages and folders alike. */
  matches: number;
  /** Folders to open so no match stays hidden; empty for an empty query. */
  openPaths: ReadonlySet<string>;
  /** The nodes to render. An empty query returns the tree itself. */
  tree: WikiTreeNode[];
}

/**
 * Keeps a node whose title matches, and every folder above a kept node. A
 * folder whose own name matches keeps everything it holds, because the folder
 * itself is the match. Matching ignores case and surrounding whitespace.
 */
export function filterWikiTree(
  nodes: WikiTreeNode[],
  query: string,
): WikiTreeFilter {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { matches: 0, openPaths: new Set(), tree: nodes };

  const openPaths = new Set<string>();
  let matches = 0;
  const keep = (candidates: WikiTreeNode[]): WikiTreeNode[] => {
    const kept: WikiTreeNode[] = [];
    for (const node of candidates) {
      const named = node.name.toLocaleLowerCase().includes(needle);
      if (node.kind === "page") {
        if (!named) continue;
        matches += 1;
        kept.push(node);
        continue;
      }
      const children = named ? node.children : keep(node.children);
      if (!named && children.length === 0) continue;
      if (named) matches += 1;
      openPaths.add(node.path);
      kept.push(named ? node : { ...node, children });
    }
    return kept;
  };

  const tree = keep(nodes);
  return { matches, openPaths, tree };
}
