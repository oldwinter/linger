import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import type { RoomDocumentMenuActions } from "@/features/rooms/documents/room-document-actions-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Select, SelectItem } from "@/components/ui/select";
import type { TeamHubDocumentTreeSummary } from "@/features/teamhub/teamhub-types";
import { writeClipboardText } from "@/lib/clipboard";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
import type { PendingDocumentUpload } from "./library-upload-queue";
import {
  visibleLibraryDocuments,
  visibleLibraryFolders,
} from "./library-visible-documents";
import type { WorkspaceTab } from "./library-workspace-tabs";

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
  fileType,
  folderActions,
  folderId,
  folders,
  onClearFilters,
  onCopy,
  onDismissError,
  onFileTypeChange,
  onOpenFolder,
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
  fileType: string;
  folderActions?: LibraryFolderRowActions;
  folderId: string | undefined;
  folders: LibraryFolder[];
  onClearFilters: () => void;
  onCopy: (document: LibraryRowDocument) => void;
  onDismissError: () => void;
  onFileTypeChange: (fileType: string) => void;
  onOpenFolder: (folderId?: string) => void;
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
}) {
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
            aria-label="Search documents and folders"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key !== "Escape" || !searchQuery) return;
              event.preventDefault();
              onSearchQueryChange("");
            }}
            placeholder="Search documents and folders..."
            role="searchbox"
            type="text"
            value={searchQuery}
          />
          {searchQuery ? (
            <button
              aria-label="Clear search"
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
              onClick={() => onSearchQueryChange("")}
              type="button"
            >
              <Icon icon={Cancel01Icon} size={12} />
            </button>
          ) : null}
        </label>
        <Select
          aria-label="File type"
          onValueChange={onFileTypeChange}
          value={fileType}
          variant="pill"
        >
          {documentFileTypes.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label="Sort documents"
          onValueChange={onSortByChange}
          value={sortBy}
          variant="pill"
        >
          <SelectItem value="updated">Sort by last modified</SelectItem>
          <SelectItem value="name">Sort by name</SelectItem>
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
        <div className="flex items-start gap-2 py-2 text-sm text-app-danger">
          <p className="min-w-0 flex-1" role="alert">
            {error}
          </p>
          <button
            className="shrink-0 rounded-md px-1.5 text-app-muted hover:bg-app-hover hover:text-app-body"
            onClick={onDismissError}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <LibraryDocumentResults
        activeView={
          folderId
            ? {
                empty: "This folder is empty",
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
          Copied
        </span>
      ) : null}
      {state === "failed" ? (
        <span className="text-xs leading-4 text-app-danger" role="alert">
          Copy failed
        </span>
      ) : null}
      <Button
        disabled={disabled}
        onClick={copyContents}
        size="compact"
        tone="secondary"
      >
        Copy contents
      </Button>
    </div>
  );
}
