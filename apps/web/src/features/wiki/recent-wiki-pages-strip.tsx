import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { useRecentDocumentsAccountId } from "@/features/library/use-recent-documents";

import {
  clearRecentWikiPages,
  readRecentWikiPages,
  type RecentWikiPage,
} from "./recent-wiki-pages";

/**
 * Wiki pages this Account opened in this browser, newest first, above the
 * daily cards. It reads local storage when the home renders instead of
 * querying, and it stays out of the page when nothing has been opened.
 */
export function RecentWikiPagesStrip() {
  const accountId = useRecentDocumentsAccountId();
  const [entries, setEntries] = useState<RecentWikiPage[]>(() =>
    readRecentWikiPages(accountId),
  );
  if (entries.length === 0) return null;
  function clear() {
    clearRecentWikiPages(accountId);
    setEntries([]);
  }
  return (
    <section
      aria-label="Recently opened Wiki pages"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <h3 className="text-xs font-medium text-app-muted">Recently opened</h3>
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link
              className="flex max-w-64 items-center rounded-full bg-card px-2.5 py-1 text-xs text-foreground shadow-outline transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={entry.path}
            >
              <span className="truncate">{entry.name}</span>
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
