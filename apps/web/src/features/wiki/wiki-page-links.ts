import { useMemo } from "react";

import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

import { useWikiDocuments } from "./knowledge-sidebar-trees";
import { wikiPageKey } from "./wiki-display-state";

/**
 * Wiki page keys to the Document route that opens each published page. Graph
 * nodes carry page keys, while an opened page is addressed by Document
 * identity.
 */
export function wikiPageHrefs(
  tenantId: string,
  documents: readonly TeamHubDocument[],
): ReadonlyMap<string, string> {
  const hrefs = new Map<string, string>();
  for (const document of documents) {
    const pageKey = document.from.find(
      (source) => source.binding_kind === "wiki_page" && source.page_key,
    )?.page_key;
    if (pageKey)
      hrefs.set(
        wikiPageKey(pageKey),
        documentDetailPath({ documentId: document.id, tenantId }),
      );
  }
  return hrefs;
}

export function useWikiPageHrefs(tenantId: string) {
  const documents = useWikiDocuments(tenantId);
  const pages = useMemo(
    () => documents.data?.pages.flatMap((page) => page.items) ?? [],
    [documents.data],
  );
  return useMemo(() => wikiPageHrefs(tenantId, pages), [pages, tenantId]);
}
