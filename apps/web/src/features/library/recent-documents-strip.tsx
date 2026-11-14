import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";

import {
  clearRecentDocuments,
  type RecentDocument,
  readRecentDocuments,
} from "./recent-documents";
import { useRecentDocumentsAccountId } from "./use-recent-documents";

/**
 * Documents this person opened in this browser, newest first, above the tree.
 * It reads local storage when the Library renders instead of querying, and it
 * stays out of the page when nothing has been opened.
 */
export function RecentDocumentsStrip({ tenantId }: { tenantId: string }) {
  const accountId = useRecentDocumentsAccountId();
  const [entries, setEntries] = useState<RecentDocument[]>(() =>
    readRecentDocuments(accountId),
  );
  if (entries.length === 0) return null;
  function clear() {
    clearRecentDocuments(accountId);
    setEntries([]);
  }
  return (
    <section
      aria-label="Recently opened"
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <h3 className="text-xs font-medium text-app-muted">Recently opened</h3>
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link
              aria-label={`${entry.name}, ${entry.formatLabel}`}
              className="flex max-w-64 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs text-foreground shadow-outline transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={documentDetailPath({
                documentId: entry.id,
                tenantId,
              })}
            >
              <span className="truncate">{entry.name}</span>
              <span className="shrink-0 text-2xs text-app-muted">
                {entry.formatLabel}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Button className="ml-auto" onClick={clear} size="compact" tone="ghost">
        Clear
      </Button>
    </section>
  );
}
