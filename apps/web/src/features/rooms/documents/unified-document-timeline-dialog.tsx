import { dateTimeFormat } from "@/lib/date-format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cancel01Icon,
  RotateLeft01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icon";
import { useMemo, useState } from "react";

import { ReadOnlyBlockNoteDocumentLoader } from "@/components/read-only-blocknote-document-loader";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { documentQueryKey } from "@/features/rooms/room-queries";
import type { TeamHubDocumentHistoryEntry } from "@/features/teamhub/teamhub-types";
import { ActorAvatar } from "@/features/rooms/members/actor-avatar";

import { diffDocumentLines } from "./document-history-diff";
import { historyRevisionMarkdown } from "./document-history-revision";

const dateFormatter = dateTimeFormat({
  dateStyle: "medium",
  timeStyle: "short",
});

export function UnifiedDocumentTimelineDialog({
  canWrite = true,
  client,
  documentId,
  onClose,
  tenantId,
}: {
  canWrite?: boolean;
  client: TeamHubClient;
  documentId: string;
  onClose: () => void;
  tenantId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    null,
  );
  const [restoreFeedback, setRestoreFeedback] = useState<string | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [highlightChanges, setHighlightChanges] = useState(true);
  const historyQueryKey = [
    "teamhub",
    "document",
    documentId,
    "history",
  ] as const;
  const history = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/documents/{documentId}/history", {
          params: { path: { documentId } },
        }),
      ),
    queryKey: historyQueryKey,
  });
  const selectedHistory =
    history.data?.items.find((entry) => entry.id === selectedHistoryId) ??
    history.data?.items[0];
  const selectedHistoryIndex = selectedHistory
    ? (history.data?.items.findIndex(
        (entry) => entry.id === selectedHistory.id,
      ) ?? -1)
    : -1;
  const previousHistory =
    selectedHistoryIndex >= 0
      ? history.data?.items[selectedHistoryIndex + 1]
      : undefined;
  const selectedHistoryContent = useHistoryMarkdown(client, selectedHistory);
  const previousHistoryContent = useHistoryMarkdown(client, previousHistory);
  const historyDiff = useMemo(() => {
    if (
      !highlightChanges ||
      selectedHistoryContent.data === undefined ||
      previousHistoryContent.data === undefined
    ) {
      return undefined;
    }
    return diffDocumentLines(
      previousHistoryContent.data,
      selectedHistoryContent.data,
    );
  }, [
    highlightChanges,
    previousHistoryContent.data,
    selectedHistoryContent.data,
  ]);
  const restore = useMutation({
    mutationFn: () => {
      if (!selectedHistory) throw new Error("No checkpoint is selected.");
      return teamHubData(
        client.api.POST(
          "/v0/documents/{documentId}/history/{historyEntryId}/restore",
          {
            params: {
              path: { documentId, historyEntryId: selectedHistory.id },
            },
          },
        ),
      );
    },
    onSuccess: async (result) => {
      setConfirmRestoreOpen(false);
      setRestoreFeedback(
        result.status === "already_current" ? "Already current." : "Restored.",
      );
      if (result.status === "restored") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: historyQueryKey }),
          queryClient.invalidateQueries({
            queryKey: documentQueryKey(tenantId, documentId),
          }),
        ]);
      }
    },
  });
  const isLatestCheckpoint = selectedHistoryIndex === 0;
  return (
    <ModalDialog
      ariaLabel="Page history"
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-popover p-0 shadow-lg backdrop:bg-[var(--app-overlay)] backdrop:backdrop-blur-sm sm:inset-0 sm:m-auto sm:h-[min(640px,82dvh)] sm:w-[calc(100%-2.5rem)] sm:max-w-3xl sm:rounded-lg"
      onClose={onClose}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-app-border px-4">
          <h2 className="text-sm font-semibold text-app-ink">Page history</h2>
          <div>
            <Button
              aria-label="Close Page history"
              onClick={onClose}
              size="icon"
              tone="ghost"
            >
              <Icon icon={Cancel01Icon} />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,2fr)] max-sm:landscape:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] max-sm:landscape:grid-rows-1 sm:grid-cols-[200px_minmax(0,1fr)] sm:grid-rows-1">
            <aside className="workspace-scrollbar min-h-0 overflow-y-auto border-b border-app-border p-3 max-sm:landscape:border-r max-sm:landscape:border-b-0 sm:border-r sm:border-b-0">
              <TimelineList
                empty="No page history saved yet."
                error={history.error}
                items={history.data?.items ?? []}
                onSelect={(id) => {
                  setSelectedHistoryId(id);
                  setConfirmRestoreOpen(false);
                  setRestoreFeedback(null);
                }}
                pending={history.isPending}
                selectedId={selectedHistory?.id}
              />
            </aside>
            <HistoryPreview
              canWrite={canWrite}
              diff={historyDiff}
              entry={selectedHistory}
              error={
                selectedHistoryContent.error ?? previousHistoryContent.error
              }
              highlightChanges={highlightChanges}
              isLatest={isLatestCheckpoint}
              loading={
                selectedHistoryContent.isPending ||
                (highlightChanges &&
                  previousHistory !== undefined &&
                  previousHistoryContent.isPending)
              }
              markdown={selectedHistoryContent.data}
              onHighlightChanges={setHighlightChanges}
              onRestore={() => {
                restore.reset();
                setConfirmRestoreOpen(true);
              }}
              previousEntry={previousHistory}
              restoreError={restore.error}
              restoreFeedback={restoreFeedback}
              restorePending={restore.isPending}
            />
          </div>
        </div>
      </div>
      {confirmRestoreOpen && selectedHistory ? (
        <ModalDialog
          closeOnBackdrop={!restore.isPending}
          description="Restoring replaces the current document content with this checkpoint. Your current version remains in page history."
          footer={
            <>
              <Button
                disabled={restore.isPending}
                onClick={() => setConfirmRestoreOpen(false)}
                tone="secondary"
              >
                Cancel
              </Button>
              <Button
                loading={restore.isPending}
                onClick={() => restore.mutate()}
                tone="primary"
              >
                Restore
              </Button>
            </>
          }
          onClose={() => {
            if (!restore.isPending) setConfirmRestoreOpen(false);
          }}
          size="sm"
          title="Restore checkpoint?"
        >
          {restore.error ? (
            <p className="px-5 py-3 text-sm text-app-danger" role="alert">
              {restore.error.message}
            </p>
          ) : null}
        </ModalDialog>
      ) : null}
    </ModalDialog>
  );
}

function useHistoryMarkdown(
  client: TeamHubClient,
  entry: TeamHubDocumentHistoryEntry | undefined,
) {
  return useQuery({
    enabled: entry !== undefined,
    queryFn: async () => {
      if (!entry) throw new Error("No checkpoint is selected.");
      const content = await teamHubData(
        client.api.GET("/v0/document-history/{historyEntryId}/content", {
          params: { path: { historyEntryId: entry.id } },
        }),
      );
      if (content.history_entry.id !== entry.id) {
        throw new Error("History Revision identity is inconsistent.");
      }
      return historyRevisionMarkdown(
        content.state_bytes,
        content.state_bytes_sha256,
      );
    },
    queryKey: ["teamhub", "document-history", entry?.id, "markdown"],
  });
}

function HistoryPreview({
  canWrite,
  diff,
  entry,
  error,
  highlightChanges,
  isLatest,
  loading,
  markdown,
  onHighlightChanges,
  onRestore,
  previousEntry,
  restoreError,
  restoreFeedback,
  restorePending,
}: {
  canWrite: boolean;
  diff: ReturnType<typeof diffDocumentLines> | undefined;
  entry: TeamHubDocumentHistoryEntry | undefined;
  error: Error | null;
  highlightChanges: boolean;
  isLatest: boolean;
  loading: boolean;
  markdown: string | undefined;
  onHighlightChanges: (value: boolean) => void;
  onRestore: () => void;
  previousEntry: TeamHubDocumentHistoryEntry | undefined;
  restoreError: Error | null;
  restoreFeedback: string | null;
  restorePending: boolean;
}) {
  return (
    <section
      aria-label="History preview"
      className="flex min-h-0 min-w-0 flex-col"
    >
      {entry ? (
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-app-border px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-app-ink">
              {dateFormatter.format(new Date(entry.created_at))}
            </p>
            <p className="truncate text-xs text-app-muted">
              {historyActors(entry)}
            </p>
          </div>
          {previousEntry ? (
            <label className="flex shrink-0 items-center gap-2 text-xs text-app-body">
              <input
                checked={highlightChanges}
                onChange={(event) =>
                  onHighlightChanges(event.currentTarget.checked)
                }
                type="checkbox"
              />
              Highlight changes
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!entry ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-app-muted">
            Select a checkpoint to preview it.
          </div>
        ) : loading ? (
          <div
            className="flex h-full items-center justify-center gap-2 text-sm text-app-muted"
            role="status"
          >
            <Spinner size={16} />
            Loading checkpoint...
          </div>
        ) : error ? (
          <p className="p-8 text-center text-sm text-app-danger" role="alert">
            {error.message}
          </p>
        ) : diff?.some((line) => line.kind !== "equal") ? (
          <HistoryDiff lines={diff} />
        ) : markdown ? (
          <div className="mx-auto max-w-[760px] px-6 py-8">
            <ReadOnlyBlockNoteDocumentLoader
              ariaLabel="Historical Document content"
              markdown={markdown}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-sm text-app-muted">
            {diff ? (
              <span className="flex items-center gap-2">
                <Icon icon={Tick02Icon} size={14} />
                This checkpoint is identical to the previous checkpoint.
              </span>
            ) : (
              "This checkpoint has no content."
            )}
          </div>
        )}
      </div>
      {entry && canWrite ? (
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-app-border px-4 py-2">
          <div className="min-w-0">
            {restoreFeedback ? (
              <p className="text-sm text-app-muted" role="status">
                {restoreFeedback}
              </p>
            ) : null}
            {restoreError ? (
              <p className="text-sm text-app-danger" role="alert">
                {restoreError.message}
              </p>
            ) : null}
          </div>
          <Button
            disabled={restorePending || isLatest}
            onClick={onRestore}
            title={isLatest ? "Already the latest checkpoint" : undefined}
            tone="primary"
          >
            {restorePending ? (
              <Spinner size={14} />
            ) : (
              <Icon icon={RotateLeft01Icon} size={14} />
            )}
            Restore checkpoint
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function HistoryDiff({
  lines,
}: {
  lines: ReturnType<typeof diffDocumentLines>;
}) {
  return (
    <div className="p-5 font-mono text-xs leading-5" role="note">
      {lines.map((line) => {
        const prefix =
          line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
        const className =
          line.kind === "add"
            ? "bg-[var(--app-status-success-surface)] text-[var(--app-status-success-text)]"
            : line.kind === "remove"
              ? "bg-[var(--app-status-danger-surface)] text-[var(--app-status-danger-text)] line-through"
              : "text-app-body";
        return (
          <div className={`flex gap-2 px-2 ${className}`} key={line.id}>
            <span className="w-3 shrink-0 select-none opacity-60">
              {prefix}
            </span>
            <span className="min-w-0 break-words whitespace-pre-wrap">
              {line.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function historyActors(entry: TeamHubDocumentHistoryEntry) {
  const actors =
    entry.contributors.length > 0 ? entry.contributors : [entry.created_by];
  return actors.map((actor) => actor.display_name).join(", ");
}

function TimelineList({
  empty,
  error,
  items,
  onSelect,
  pending,
  selectedId,
}: {
  empty: string;
  error: Error | null;
  items: TeamHubDocumentHistoryEntry[];
  onSelect?: (id: string) => void;
  pending: boolean;
  selectedId?: string;
}) {
  if (pending) {
    return (
      <p
        className="flex items-center justify-center gap-2 py-16 text-sm text-app-muted"
        role="status"
      >
        <Spinner size={16} />
        Loading timeline...
      </p>
    );
  }
  if (error) {
    return (
      <p className="py-12 text-center text-sm text-app-danger" role="alert">
        {error.message}
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="py-16 text-center text-sm text-app-muted">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-app-border/60">
      {items.map((item) => (
        <li key={item.id}>
          <button
            aria-pressed={onSelect ? item.id === selectedId : undefined}
            className={`flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left transition-colors duration-300 ${
              item.id === selectedId ? "bg-accent" : "hover:bg-muted/70"
            }`}
            disabled={!onSelect}
            onClick={() => onSelect?.(item.id)}
            type="button"
          >
            <ActorAvatar
              actorId={item.created_by.id}
              kind={item.created_by.kind}
              name={item.created_by.display_name}
              size="xs"
            />
            <span className="min-w-0">
              <strong className="block truncate text-sm font-medium text-app-ink">
                {dateFormatter.format(new Date(item.created_at))}
              </strong>
              <span className="mt-0.5 block text-xs text-app-muted">
                {item.created_by.display_name}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
