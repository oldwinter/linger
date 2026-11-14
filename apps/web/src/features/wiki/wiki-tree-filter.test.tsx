import { describe, expect, it } from "vitest";

import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

import { buildWikiDocumentTree, type WikiTreeNode } from "./wiki-tree";
import { filterWikiTree } from "./wiki-tree-filter";
import { wikiDocument } from "./wiki.test-support";

describe("filterWikiTree", () => {
  it("keeps a page whose title matches and the folders above it", () => {
    const filtered = filterWikiTree(
      wikiTree(
        "people/casey-example.md",
        "projects/lev8.md",
        "projects/lev8/design.md",
      ),
      "design",
    );

    expect(shape(filtered.tree)).toEqual([
      "projects/",
      "projects/lev8/",
      "projects/lev8/design.md",
    ]);
    expect(filtered.matches).toBe(1);
    expect([...filtered.openPaths].sort()).toEqual([
      "projects",
      "projects/lev8",
    ]);
  });

  it("ignores case and the query's surrounding space", () => {
    const filtered = filterWikiTree(
      wikiTree("people/casey-example.md", "projects/lev8.md"),
      "  CASEY  ",
    );

    expect(shape(filtered.tree)).toEqual([
      "people/",
      "people/casey-example.md",
    ]);
    expect(filtered.matches).toBe(1);
  });

  it("keeps a folder whose own name matches, with everything it holds", () => {
    const filtered = filterWikiTree(
      wikiTree("people/casey-example.md", "people/dana-example.md"),
      "people",
    );

    expect(shape(filtered.tree)).toEqual([
      "people/",
      "people/casey-example.md",
      "people/dana-example.md",
    ]);
    expect(filtered.matches).toBe(1);
    expect([...filtered.openPaths]).toEqual(["people"]);
  });

  it("counts every matching title, not the folders kept to reach them", () => {
    const filtered = filterWikiTree(
      wikiTree(
        "people/casey-example.md",
        "projects/casey-plan.md",
        "projects/lev8/design.md",
      ),
      "casey",
    );

    expect(shape(filtered.tree)).toEqual([
      "people/",
      "people/casey-example.md",
      "projects/",
      "projects/casey-plan.md",
    ]);
    expect(filtered.matches).toBe(2);
  });

  it("returns the tree untouched for an empty query", () => {
    const tree = wikiTree("people/casey-example.md", "projects/lev8.md");

    for (const query of ["", "   "]) {
      const filtered = filterWikiTree(tree, query);
      expect(filtered.tree).toBe(tree);
      expect(filtered.matches).toBe(0);
      expect(filtered.openPaths.size).toBe(0);
    }
  });

  it("reports no match and drops every folder", () => {
    const filtered = filterWikiTree(
      wikiTree("people/casey-example.md", "projects/lev8.md"),
      "absent",
    );

    expect(filtered.tree).toEqual([]);
    expect(filtered.matches).toBe(0);
    expect(filtered.openPaths.size).toBe(0);
  });
});

function wikiTree(...pageKeys: string[]): WikiTreeNode[] {
  return buildWikiDocumentTree(pageKeys.map(pageAt));
}

function pageAt(pageKey: string): TeamHubDocument {
  const document = wikiDocument(pageKey, pageKey, "wiki_page");
  return { ...document, from: [{ ...document.from[0]!, page_key: pageKey }] };
}

/** The filtered tree written as paths, folders marked with a trailing slash. */
function shape(nodes: WikiTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "page"
      ? [node.path]
      : [`${node.path}/`, ...shape(node.children)],
  );
}
