import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useRecentDocumentsAccountId } from "@/features/library/use-recent-documents";

import {
  clearRecentWikiPages,
  readRecentWikiPages,
  type RecentWikiPage,
  removeRecentWikiPage,
} from "./recent-wiki-pages";

/** Where a removal hands focus: another entry's Forget control, or the status. */
type RemovalFocus = { entryId: string } | "empty";

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
  // Forgetting the last page keeps the section with its empty status so the
  // removal is announced instead of focus falling to the page.
  const [emptied, setEmptied] = useState(false);
  // Where focus lands once the removal has rendered.
  const [focusAfterRemoval, setFocusAfterRemoval] =
    useState<RemovalFocus | null>(null);
  const forgetRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusAfterRemoval === null) return;
    const target =
      focusAfterRemoval === "empty"
        ? emptyRef.current
        : forgetRefs.current.get(focusAfterRemoval.entryId);
    target?.focus();
    setFocusAfterRemoval(null);
  }, [focusAfterRemoval]);
  if (entries.length === 0 && !emptied) return null;
  function clear() {
    clearRecentWikiPages(accountId);
    setEntries([]);
  }
  // Forgetting one page keeps the rest of the strip as it was, and hands focus
  // to the entry that took its place.
  function forget(pageId: string) {
    const index = entries.findIndex((entry) => entry.id === pageId);
    const remaining = entries.filter((entry) => entry.id !== pageId);
    removeRecentWikiPage(accountId, pageId);
    setEntries(remaining);
    if (remaining.length === 0) {
      setEmptied(true);
      setFocusAfterRemoval("empty");
      return;
    }
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    setFocusAfterRemoval(next ? { entryId: next.id } : "empty");
  }
  return (
    <section
      aria-label="Recently opened Wiki pages"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <h3 className="text-xs font-medium text-app-muted">Recently opened</h3>
      {entries.length === 0 ? (
        <p
          className="text-xs text-app-muted"
          ref={emptyRef}
          role="status"
          tabIndex={-1}
        >
          No recently opened pages
        </p>
      ) : (
        <>
          <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="flex max-w-64 items-center gap-1 rounded-full bg-card pr-0.5 pl-2.5 text-xs text-foreground shadow-outline transition-colors hover:bg-accent">
                  <Link
                    className="flex min-w-0 items-center self-stretch rounded-full transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    to={entry.path}
                  >
                    <span className="truncate">{entry.name}</span>
                  </Link>
                  <button
                    aria-label={`Forget ${entry.name}`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => forget(entry.id)}
                    ref={(node) => {
                      if (node) forgetRefs.current.set(entry.id, node);
                      else forgetRefs.current.delete(entry.id);
                    }}
                    type="button"
                  >
                    <Icon icon={Cancel01Icon} size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <Button
            className="ml-auto"
            onClick={clear}
            size="compact"
            tone="ghost"
          >
            Clear
          </Button>
        </>
      )}
    </section>
  );
}
