import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";

import {
  clearRecentDocuments,
  type RecentDocument,
  readRecentDocuments,
  removeRecentDocument,
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
  // Forgetting one Document keeps the rest of the strip as it was.
  function forget(documentId: string) {
    removeRecentDocument(accountId, documentId);
    setEntries((current) => current.filter((entry) => entry.id !== documentId));
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
            <span className="flex max-w-64 items-center gap-1.5 rounded-full bg-card py-1 pr-1 pl-2.5 text-xs text-foreground shadow-outline">
              <Link
                aria-label={`${entry.name}, ${entry.formatLabel}`}
                className="min-w-0 truncate rounded-full transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={documentDetailPath({
                  documentId: entry.id,
                  tenantId,
                })}
              >
                {entry.name}
              </Link>
              <span className="shrink-0 text-2xs text-app-muted">
                {entry.formatLabel}
              </span>
              <button
                aria-label={`Forget ${entry.name}`}
                className="flex size-4 shrink-0 items-center justify-center rounded-full text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => forget(entry.id)}
                type="button"
              >
                <Icon icon={Cancel01Icon} size={10} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <Button className="ml-auto" onClick={clear} size="compact" tone="ghost">
        Clear
      </Button>
    </section>
  );
}
