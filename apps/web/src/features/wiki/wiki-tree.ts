import { documentFileName } from "@/features/library/document-display-name";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

export type WikiTreeNode = WikiTreeDirectory | WikiTreePage;

export interface WikiTreeDirectory {
  children: WikiTreeNode[];
  kind: "directory";
  name: string;
  path: string;
}

export interface WikiTreePage {
  document: TeamHubDocument;
  kind: "page";
  name: string;
  path: string;
}

interface MutableWikiDirectory {
  directories: Map<string, MutableWikiDirectory>;
  name: string;
  pages: WikiTreePage[];
  path: string;
}

export function buildWikiDocumentTree(
  documents: TeamHubDocument[],
): WikiTreeNode[] {
  const root: MutableWikiDirectory = {
    directories: new Map(),
    name: "",
    pages: [],
    path: "",
  };
  for (const document of documents) {
    const pagePath = wikiPagePath(document);
    const segments = pagePath.split("/").filter(Boolean);
    const name = segments.pop() ?? documentFileName(document);
    let directory = root;
    for (const segment of segments) {
      const childPath = directory.path
        ? `${directory.path}/${segment}`
        : segment;
      let child = directory.directories.get(segment);
      if (!child) {
        child = {
          directories: new Map(),
          name: segment,
          pages: [],
          path: childPath,
        };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.pages.push({ document, kind: "page", name, path: pagePath });
  }
  return finalizeWikiDirectory(root);
}

function finalizeWikiDirectory(
  directory: MutableWikiDirectory,
): WikiTreeNode[] {
  const directories: WikiTreeDirectory[] = [...directory.directories.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((child) => ({
      children: finalizeWikiDirectory(child),
      kind: "directory",
      name: child.name,
      path: child.path,
    }));
  const pages = directory.pages.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  return [...directories, ...pages];
}

/** The tree as rows: each node that is visible under the open directories. */
export function flattenWikiTree(
  nodes: WikiTreeNode[],
  expandedPaths: ReadonlySet<string>,
  depth = 0,
): Array<{ depth: number; node: WikiTreeNode }> {
  return nodes.flatMap((node) => [
    { depth, node },
    ...(node.kind === "directory" && expandedPaths.has(node.path)
      ? flattenWikiTree(node.children, expandedPaths, depth + 1)
      : []),
  ]);
}

export function wikiPagePath(document: TeamHubDocument) {
  return (
    document.from.find((source) => source.binding_kind === "wiki_page")
      ?.page_key ?? documentFileName(document)
  );
}
