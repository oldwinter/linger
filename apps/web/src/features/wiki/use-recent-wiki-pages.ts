import { useEffect } from "react";

import { useRecentDocumentsAccountId } from "@/features/library/use-recent-documents";

import { recordRecentWikiPage } from "./recent-wiki-pages";

/**
 * Records the Wiki page the person opened. Callers pass the identity they
 * already render, so opening a page never fetches to learn its name.
 */
export function useRecordRecentWikiPage(
  page:
    | { id: string; name: string; path: string; tenantId: string }
    | undefined,
) {
  const accountId = useRecentDocumentsAccountId();
  const id = page?.id;
  const name = page?.name;
  const path = page?.path;
  const tenantId = page?.tenantId;
  useEffect(() => {
    if (!accountId || !tenantId || !id || !name || !path) return;
    recordRecentWikiPage(accountId, tenantId, {
      id,
      name,
      openedAt: new Date().toISOString(),
      path,
    });
  }, [accountId, id, name, path, tenantId]);
}
