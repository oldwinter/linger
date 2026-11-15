import { useEffect } from "react";

import { useRecentDocumentsAccountId } from "@/features/library/use-recent-documents";

import { recordRecentWikiPage } from "./recent-wiki-pages";

/**
 * Records the Wiki page the person opened. Callers pass the identity they
 * already render, so opening a page never fetches to learn its name.
 */
export function useRecordRecentWikiPage(
  page: { id: string; name: string; path: string } | undefined,
) {
  const accountId = useRecentDocumentsAccountId();
  const id = page?.id;
  const name = page?.name;
  const path = page?.path;
  useEffect(() => {
    if (!accountId || !id || !name || !path) return;
    recordRecentWikiPage(accountId, {
      id,
      name,
      openedAt: new Date().toISOString(),
      path,
    });
  }, [accountId, id, name, path]);
}
