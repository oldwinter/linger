import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Select, SelectItem } from "@/components/ui/select";
import type { RoomDocumentMenuActions } from "@/features/rooms/documents/room-document-actions-menu";
import type { TeamHubDocumentTreeSummary } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";
import { writeClipboardText } from "@/lib/clipboard";

import { documentFileTypes } from "./document-file-types";
import { folderContentsMarkdown } from "./library-folder-contents";
import {
  LibraryDocumentResults,
  type LibraryEmptyActions,
  type LibraryRowDocument,
} from "./library-document-results";
import {
  type LibraryFolder,
  type LibraryFolderRowActions,
  LibraryFolderBreadcrumb,
} from "./library-folder-browser";
import type {
  PendingDocumentUpload,
  UploadFailure,
} from "./library-upload-queue";
import {
  visibleLibraryDocuments,
  visibleLibraryFolders,
} from "./library-visible-documents";
import type { WorkspaceTab } from "./library-workspace-tabs";
import { libraryMessages as m } from "./library.messages";

/**
 * One open folder level of My pages or Shared with me: search, type and sort
 * filters, the breadcrumb, errors, queued uploads and the rows themselves.
 */
export function LibraryFolderListing({
  activeView,
  browsedError,
  browsedPending,
  bulkBar,
  documentActions,
  documents,
  emptyActions,
  error,
  failedUploads = [],
  fileType,
  folderActions,
  folderId,
  folders,
  onClearFilters,
  onCopy,
  onDismissError,
  onDismissFailedUpload,
  onFileTypeChange,
  onOpenFolder,
  onRetryAllFailedUploads,
  onRetryFailedUpload,
  onSearchQueryChange,
  onSortByChange,
  onToggleSelected,
  pendingUploads,
  searchQuery,
  selectedDocumentIds,
  sortBy,
  tab,
  tenantId,
  trail,
  uploadsActive = false,
}: {
  activeView: { empty: string; label: string };
  browsedError: Error | null;
  browsedPending: boolean;
  bulkBar?: ReactNode;
  documentActions: (
    document: TeamHubDocumentTreeSummary,
  ) => RoomDocumentMenuActions;
  documents: LibraryRowDocument[];
  emptyActions?: LibraryEmptyActions;
  error: string | null;
  failedUploads?: readonly UploadFailure[];
  fileType: string;
  folderActions?: LibraryFolderRowActions;
  folderId: string | undefined;
  folders: LibraryFolder[];
  onClearFilters: () => void;
  onCopy: (document: LibraryRowDocument) => void;
  onDismissError: () => void;
  onDismissFailedUpload?: (failureId: string) => void;
  onFileTypeChange: (fileType: string) => void;
  onOpenFolder: (folderId?: string) => void;
  onRetryAllFailedUploads?: () => void;
  onRetryFailedUpload?: (failureId: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSortByChange: (sortBy: string) => void;
  onToggleSelected: (documentId: string) => void;
  pendingUploads: readonly PendingDocumentUpload[];
  searchQuery: string;
  selectedDocumentIds: ReadonlySet<string>;
  sortBy: string;
  tab: Exclude<WorkspaceTab, "meetings">;
  tenantId: string;
  trail: readonly LibraryFolder[];
  uploadsActive?: boolean;
}) {
  const t = useT();
  const visibleDocuments = visibleLibraryDocuments(documents, {
    fileType,
    query: searchQuery,
    sortBy,
  });
  const visibleFolders = visibleLibraryFolders(folders, {
    query: searchQuery,
    sortBy,
  });
  const isFiltered = Boolean(fileType) || Boolean(searchQuery.trim());
  /** The open folder names the copy; the tab names it at the root level. */
  const contentsHeading = folderId ? trail.at(-1)!.name : activeView.label;
  return (
    <>
      {bulkBar}
      <div className="workspace-file-filters">
        <label className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40 sm:w-64">
          <Icon icon={Search01Icon} size={14} />
          <input
            aria-label={t(m.searchDocumentsAndFolders)}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key !== "Escape" || !searchQuery) return;
              event.preventDefault();
              onSearchQueryChange("");
            }}
            placeholder={t(m.searchDocumentsAndFoldersPlaceholder)}
            role="searchbox"
            type="text"
            value={searchQuery}
          />
          {searchQuery ? (
            <button
              aria-label={t(m.clearSearch)}
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
              onClick={() => onSearchQueryChange("")}
              type="button"
            >
              <Icon icon={Cancel01Icon} size={12} />
            </button>
          ) : null}
        </label>
        <Select
          aria-label={t(m.fileType)}
          onValueChange={onFileTypeChange}
          value={fileType}
          variant="pill"
        >
          {documentFileTypes.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {t(label)}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label={t(m.sortDocuments)}
          onValueChange={onSortByChange}
          value={sortBy}
          variant="pill"
        >
          <SelectItem value="updated">{t(m.sortByModified)}</SelectItem>
          <SelectItem value="name">{t(m.sortByName)}</SelectItem>
        </Select>
        <FolderContentsCopyAction
          disabled={browsedPending || visibleDocuments.length === 0}
          documents={visibleDocuments}
          folderName={contentsHeading}
          tenantId={tenantId}
        />
      </div>
      {folderId ? (
        <LibraryFolderBreadcrumb
          onOpen={onOpenFolder}
          rootLabel={activeView.label}
          trail={trail}
        />
      ) : null}
      {error ? (
        <div className="my-2 flex flex-col gap-2 rounded-lg border border-[var(--app-danger-border)] bg-[var(--app-danger-hover)] px-3 py-2 text-sm text-app-danger">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1" role="alert">
              {error}
            </p>
            {failedUploads.filter((failure) => failure.source).length > 1 &&
            onRetryAllFailedUploads ? (
              <Button
                disabled={uploadsActive}
                onClick={onRetryAllFailedUploads}
                size="compact"
                tone="secondary"
              >
                {t(m.retryAllUploads)}
              </Button>
            ) : failedUploads.length === 1 &&
              failedUploads[0]?.id &&
              failedUploads[0]?.source &&
              onRetryFailedUpload ? (
              <Button
                disabled={uploadsActive}
                onClick={() => onRetryFailedUpload(failedUploads[0]!.id!)}
                size="compact"
                tone="secondary"
              >
                {t(m.retryUpload)}
              </Button>
            ) : null}
            <button
              data-voice-close=""
              className="min-h-8 shrink-0 rounded-md px-2 text-xs text-app-muted hover:bg-app-hover hover:text-app-body"
              onClick={onDismissError}
              type="button"
            >
              {t(m.dismiss)}
            </button>
          </div>
          {failedUploads.length > 1 ? (
            <ul className="space-y-1.5 border-t border-[var(--app-danger-border)]/50 pt-2 text-xs">
              {failedUploads.map((failure, index) => {
                const text =
                  typeof failure.message === "string"
                    ? failure.message
                    : t(failure.message);
                return (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2"
                    key={failure.id ?? `${failure.filename}-${index}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {t(m.uploadFailure, {
                        filename: failure.filename,
                        message: text,
                      })}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {failure.id && failure.source && onRetryFailedUpload ? (
                        <Button
                          disabled={uploadsActive}
                          onClick={() => onRetryFailedUpload(failure.id!)}
                          size="compact"
                          tone="secondary"
                        >
                          {t(m.retryUpload)}
                        </Button>
                      ) : null}
                      {failure.id && onDismissFailedUpload ? (
                        <button
                          className="min-h-7 rounded-md px-1.5 text-app-muted hover:bg-app-hover hover:text-app-body"
                          data-voice-close=""
                          onClick={() => onDismissFailedUpload(failure.id!)}
                          type="button"
                        >
                          {t(m.dismiss)}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      <LibraryDocumentResults
        activeView={
          folderId
            ? {
                empty: t(m.folderEmpty),
                label: trail.at(-1)!.name,
              }
            : activeView
        }
        documents={visibleDocuments}
        documentActions={documentActions}
        emptyActions={emptyActions}
        error={browsedError}
        folderActions={folderActions}
        folders={visibleFolders}
        isFiltered={isFiltered}
        onClearFilters={onClearFilters}
        onCopy={onCopy}
        onOpenFolder={onOpenFolder}
        onToggleSelected={onToggleSelected}
        pending={browsedPending}
        pendingUploads={
          tab === "owned"
            ? pendingUploads.filter((upload) => upload.parentId === folderId)
            : []
        }
        section={tab === "shared" ? "shared-with-me" : "my-documents"}
        selectedDocumentIds={selectedDocumentIds}
        tenantId={tenantId}
      />
    </>
  );
}

/** Long enough to read, matching the other copy actions. */
const FOLDER_COPIED_MS = 1200;

/**
 * Copies the open folder's Documents, in the order and filter the list shows
 * them, as one Markdown roster. Subfolders are rows of their own, not contents.
 */
function FolderContentsCopyAction({
  disabled,
  documents,
  folderName,
  tenantId,
}: {
  disabled: boolean;
  documents: readonly LibraryRowDocument[];
  folderName: string;
  tenantId: string;
}) {
  const t = useT();
  const [state, setState] = useState<"copied" | "failed">();
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copyContents() {
    if (disabled) return;
    window.clearTimeout(resetTimer.current);
    setState(undefined);
    void writeClipboardText(
      folderContentsMarkdown({
        documents,
        folderName,
        origin: window.location.origin,
        tenantId,
      }),
    ).then(
      () => {
        setState("copied");
        resetTimer.current = window.setTimeout(
          () => setState(undefined),
          FOLDER_COPIED_MS,
        );
      },
      () => setState("failed"),
    );
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {state === "copied" ? (
        <span className="text-xs leading-4 text-app-muted" role="status">
          {t(commonMessages.copied)}
        </span>
      ) : null}
      {state === "failed" ? (
        <span className="text-xs leading-4 text-app-danger" role="alert">
          {t(m.copyFailed)}
        </span>
      ) : null}
      <Button
        disabled={disabled}
        onClick={copyContents}
        size="compact"
        tone="secondary"
      >
        {t(m.copyContents)}
      </Button>
    </div>
  );
}
