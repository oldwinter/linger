import { useEffect, useState } from "react";
import { Link } from "react-router";

import { documentFileName } from "@/features/library/document-display-name";
import { useRecentDocumentsAccountId } from "@/features/library/use-recent-documents";

import { useWikiDocuments } from "./knowledge-sidebar-trees";
import { overnightWikiPage } from "./wiki-overnight-page";
import {
  readRecentWikiPages,
  subscribeRecentWikiPages,
} from "./recent-wiki-pages";
import {
  useWikiDisplayState,
  wikiPageKey,
  wikiPagePath,
} from "./wiki-display-state";
import { wikiDocumentPath } from "./wiki-routes";

/**
 * The page Another Me finished yesterday, at the front of Wiki, until it is
 * opened. Opening the page records the read and the wait ends.
 */
export function WikiOvernightWait({
  refreshing,
  tenantId,
}: {
  refreshing: boolean;
  tenantId: string;
}) {
  const accountId = useRecentDocumentsAccountId();
  const documents = useWikiDocuments(tenantId);
  const display = useWikiDisplayState(tenantId);
  const pages = (
    documents.data?.pages.flatMap((page) => page.items) ?? []
  ).filter(
    (page) => display.decisions[wikiPageKey(wikiPagePath(page))] !== "delete",
  );
  const [read, setRead] = useState(() =>
    readRecentWikiPages(accountId, tenantId),
  );
  useEffect(() => {
    const refresh = () => setRead(readRecentWikiPages(accountId, tenantId));
    refresh();
    return subscribeRecentWikiPages(refresh);
  }, [accountId, tenantId]);
  if (refreshing) return null;
  const page = overnightWikiPage(pages, read, new Date());
  if (!page) return null;
  const name = documentFileName(page).replace(/\.md$/i, "");
  return (
    <Link
      className="mb-6 block text-xl text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to={wikiDocumentPath(tenantId, page.id)}
    >
      {name}
    </Link>
  );
}
