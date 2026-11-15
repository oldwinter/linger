import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";

import {
  clearRecentDocuments,
  type RecentDocument,
  readRecentDocuments,
  removeRecentDocument,
  subscribeRecentDocuments,
} from "./recent-documents";
import { useRecentDocumentsAccountId } from "./use-recent-documents";

/** Where a removal hands focus: another entry's Forget control, or the status. */
type RemovalFocus = { entryId: string } | "empty";

/**
 * Documents this person opened in this browser, newest first, above the tree.
 * It reads local storage when the Library renders instead of querying, and it
 * stays out of the page when nothing has been opened.
 */
export function RecentDocumentsStrip({ tenantId }: { tenantId: string }) {
  const accountId = useRecentDocumentsAccountId();
  const [entries, setEntries] = useState<RecentDocument[]>(() =>
    readRecentDocuments(accountId, tenantId),
  );
  // Forgetting the last Document keeps the section with its empty status so the
  // removal is announced instead of focus falling to the page.
  const [emptied, setEmptied] = useState(false);
  // Where focus lands once the removal has rendered.
  const [focusAfterRemoval, setFocusAfterRemoval] =
    useState<RemovalFocus | null>(null);
  const forgetRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const refresh = () => {
      const next = readRecentDocuments(accountId, tenantId);
      setEntries(next);
      if (next.length > 0) setEmptied(false);
    };
    refresh();
    return subscribeRecentDocuments(refresh);
  }, [accountId, tenantId]);
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
    clearRecentDocuments(accountId, tenantId);
    setEntries([]);
  }
  // Forgetting one Document keeps the rest of the strip as it was, and hands
  // focus to the entry that took its place.
  function forget(documentId: string) {
    const index = entries.findIndex((entry) => entry.id === documentId);
    const remaining = entries.filter((entry) => entry.id !== documentId);
    removeRecentDocument(accountId, tenantId, documentId);
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
      aria-label="Recently opened"
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <h3 className="text-xs font-medium text-app-muted">Recently opened</h3>
      {entries.length === 0 ? (
        <p
          className="text-xs text-app-muted"
          ref={emptyRef}
          role="status"
          tabIndex={-1}
        >
          No recently opened documents
        </p>
      ) : (
        <>
          <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="flex max-w-64 items-center gap-1 rounded-full bg-card pr-0.5 pl-2.5 text-xs text-foreground shadow-outline transition-colors hover:bg-accent">
                  <Link
                    aria-label={`${entry.name}, ${entry.formatLabel}`}
                    className="flex min-w-0 items-center gap-1.5 self-stretch rounded-full transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
