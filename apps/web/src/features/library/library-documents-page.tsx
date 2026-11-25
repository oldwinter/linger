import { Calendar03Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { FileDropTarget } from "@/components/ui/file-drop-target";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { dayReviewPath } from "@/features/memory/day-review";
import { writeDocumentLinkClipboard } from "@/features/rooms/files/document-clipboard-link";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import type { RoomDocumentMenuActions } from "@/features/rooms/documents/room-document-actions-menu";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocumentTreeSummary } from "@/features/teamhub/teamhub-types";
import { MeetingsPanel } from "@/features/memory/meetings-panel";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import {
  CopyToMyDocumentsDialog,
  useCopyToMyDocuments,
} from "./copy-to-my-documents-dialog";
import { DocumentDeleteDialog } from "./document-delete-dialog";
import { documentFileName } from "./document-display-name";
import { RecentDocumentCards } from "./library-document-results";
import { LibraryDocumentsHeader } from "./library-documents-header";
import {
  DeleteFolderDialog,
  LibraryUploadSummary,
  NewFolderDialog,
  RenameFolderDialog,
} from "./library-folder-browser";
import { LibraryFolderListing } from "./library-folder-listing";
import { libraryMessages as m } from "./library.messages";
import { MoveFolderPickerDialog } from "./move-folder-picker-dialog";
import { readDroppedUploadSources } from "./library-upload-queue";
import { visibleLibraryDocuments } from "./library-visible-documents";
import { libraryWeekPath } from "./library-week";
import { RecentDocumentsStrip } from "./recent-documents-strip";
import {
  type LibraryBulkOutcome,
  useLibraryBulkActions,
} from "./use-library-bulk-actions";
import {
  type WorkspaceTab,
  WorkspaceTabs,
  workspaceTabs,
} from "./library-workspace-tabs";
import {
  type DocumentTreeFolder,
  isFolderMoveCycle,
  nextFolderName,
} from "./my-documents-tree-helpers";
import { MyDocumentsTreeView } from "./my-documents-tree-view";
import { SharedDocumentsTree } from "./shared-documents-tree";
import { canRenameDocument, useDocumentRename } from "./use-document-rename";
import {
  useLibraryDocuments,
  useLibraryFolderLevel,
} from "./use-library-folder-level";
import {
  type MyDocumentsTreeProps,
  useMyDocumentsTreeModel,
} from "./use-my-documents-tree-model";

const UnifiedDocumentTimelineDialog = lazy(() =>
  import("@/features/rooms/documents/unified-document-timeline-dialog").then(
    (module) => ({ default: module.UnifiedDocumentTimelineDialog }),
  ),
);

/** The centered Library column fits one row of four Recent cards. */
const RECENT_CARD_LIMIT = 4;

export function LibraryDocumentsPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const [searchParams, setSearchParams] = useSearchParams();
  const rename = useDocumentRename(tenantId);
  const [historyDocumentId, setHistoryDocumentId] = useState<string | null>(
    null,
  );
  // The tab lives in the URL so a refresh, or Back from a Document, returns to it.
  const tab: WorkspaceTab =
    workspaceTabs.find((candidate) => candidate.id === searchParams.get("tab"))
      ?.id ?? "owned";
  const [fileType, setFileType] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("updated");
  const copy = useCopyToMyDocuments(client, tenantId);
  const { tree, treeModel, reload } = useOwnedDocumentTree(client, tenantId);
  const treeItems = tree.data?.items ?? [];
  const treeFolders = treeItems.filter(
    (item): item is DocumentTreeFolder => item.node_kind === "folder",
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const { browsedTree, folderId, levelDocuments, openedFolder, trail } =
    useLibraryFolderLevel({
      client,
      fileType,
      requestedFolder: searchParams.get("folder"),
      searchQuery,
      tab,
      tenantId,
      tree,
    });
  const bulk = useLibraryBulkActions({
    client,
    documents: levelDocuments,
    items: treeItems,
    onChanged: reload,
    resetKey: `${tab}:${folderId ?? ""}`,
    tenantId,
  });
  // Copy links follows the rows the list shows, in its order.
  const copyDocuments = visibleLibraryDocuments(levelDocuments, {
    fileType,
    query: searchQuery,
    sortBy,
  }).filter((document) => bulk.selectedDocumentIds.has(document.id));
  function chooseTab(next: WorkspaceTab) {
    // A selection and inline search belong to the tab they were made in.
    bulk.clear();
    setSearchQuery("");
    setSearchParams(next === "owned" ? {} : { tab: next }, { replace: true });
  }
  // An open folder also lives in the URL, so Back leaves the folder.
  function openFolder(nextFolderId?: string) {
    bulk.clear();
    setSearchQuery("");
    setSearchParams({
      ...(tab === "owned" ? {} : { tab }),
      ...(nextFolderId ? { folder: nextFolderId } : {}),
    });
  }
  const ownedFolderId = tab === "owned" ? folderId : undefined;
  const recent = useLibraryDocuments(tenantId, "recent", true);
  const recentDocuments = (recent.data?.pages[0]?.items ?? []).slice(
    0,
    RECENT_CARD_LIMIT,
  );
  const view =
    workspaceTabs.find((candidate) => candidate.id === tab) ?? workspaceTabs[0];
  const activeView = {
    empty: view.empty ? t(view.empty) : "",
    label: t(view.label),
  };
  const documentActions = (
    document: TeamHubDocumentTreeSummary,
  ): RoomDocumentMenuActions => ({
    canUseVersion: true,
    canRename: canRenameDocument(document),
    canDelete: document.capabilities.delete,
    canDuplicate: document.capabilities.duplicate,
    canExport: document.capabilities.export,
    busy: treeModel.trashPending,
    onCopyLink: () => void copyDocumentLink(document, tenantId),
    onRename: () => rename.beginRename(document),
    onDelete: () => treeModel.onTrashDocument(document),
    onDuplicate: () => treeModel.onDuplicateDocument(document),
    onExport: () => treeModel.onExportDocument(document),
    onShowHistory: () => setHistoryDocumentId(document.id),
  });
  const createBusy =
    Boolean(treeModel.creating) || treeModel.pending || Boolean(tree.error);
  const confirmingDeleteFolder = treeModel.confirmingDeleteFolderId
    ? treeFolders.find(
        (folder) => folder.id === treeModel.confirmingDeleteFolderId,
      )
    : undefined;
  const movingFolderDisabledIds = new Set<string>();
  if (treeModel.movingPlacement?.node_kind === "folder") {
    for (const folder of treeFolders) {
      if (isFolderMoveCycle(treeModel.movingPlacement.id, folder.id, treeItems))
        movingFolderDisabledIds.add(folder.id);
    }
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {copy.copyingDocument ? (
        <CopyToMyDocumentsDialog
          document={copy.copyingDocument}
          error={copy.copyError}
          folders={treeFolders}
          items={treeItems}
          onCancel={copy.cancelCopy}
          onCopy={(targetFolderId) =>
            void copy.copyToMyDocuments(targetFolderId)
          }
          pending={copy.copyPending}
        />
      ) : null}
      {rename.dialog}
      {creatingFolder ? (
        <NewFolderDialog
          defaultName={nextFolderName(treeItems, ownedFolderId, t)}
          onCancel={() => setCreatingFolder(false)}
          onCreate={async (name) => {
            await treeModel.onCreateNamedFolder(name, ownedFolderId);
            setCreatingFolder(false);
            if (tab !== "owned") chooseTab("owned");
          }}
        />
      ) : null}
      {treeModel.renamingFolder ? (
        <RenameFolderDialog
          error={treeModel.error}
          name={treeModel.renamingFolder.name}
          onCancel={() => {
            treeModel.onRenameCancel();
            treeModel.onDismissError();
          }}
          onChange={treeModel.onRenameChange}
          onSubmit={treeModel.onRenameSubmit}
        />
      ) : null}
      {treeModel.movingPlacement ? (
        <MoveFolderPickerDialog
          currentParentId={treeModel.movingPlacement.parent_id}
          disabledFolderIds={movingFolderDisabledIds}
          folders={treeFolders}
          label={
            treeModel.movingPlacement.node_kind === "folder"
              ? treeModel.movingPlacement.name
              : "document"
          }
          onCancel={treeModel.onMoveCancel}
          onMove={(parentId) =>
            treeModel.onMove(treeModel.movingPlacement!, parentId)
          }
          rootLabel="Owned by Me"
        />
      ) : null}
      {confirmingDeleteFolder ? (
        <DeleteFolderDialog
          name={confirmingDeleteFolder.name}
          onCancel={treeModel.onCancelDeleteFolder}
          onConfirm={treeModel.onConfirmDeleteFolder}
          pending={Boolean(treeModel.deletingFolderId)}
        />
      ) : null}
      {historyDocumentId ? (
        <DocumentHistoryDialog
          client={client}
          documentId={historyDocumentId}
          onClose={() => setHistoryDocumentId(null)}
          tenantId={tenantId}
        />
      ) : null}
      {treeModel.trashingDocument ? (
        <DocumentDeleteDialog
          error={treeModel.error}
          onCancel={treeModel.onTrashCancel}
          onConfirm={treeModel.onTrashConfirm}
          pending={treeModel.trashPending}
          title={treeModel.trashingDocument.title}
        />
      ) : null}
      {bulk.moving ? (
        <MoveFolderPickerDialog
          currentParentId={ownedFolderId}
          folders={treeFolders}
          label={
            bulk.moving.length === 1
              ? "1 document"
              : `${bulk.moving.length} documents`
          }
          onCancel={bulk.cancel}
          onMove={(parentId) => void bulk.moveTo(parentId)}
          rootLabel="Owned by Me"
        />
      ) : null}
      {bulk.trashing ? (
        <DocumentDeleteDialog
          onCancel={bulk.cancel}
          onConfirm={() => void bulk.trash()}
          pending={bulk.pending}
          title={
            bulk.trashing.length === 1
              ? documentFileName(bulk.trashing[0]!)
              : `${bulk.trashing.length} documents`
          }
        />
      ) : null}
      <FileDropTarget
        // Dropped files and folders land in the open folder, or My pages root.
        canAccept={() => tab === "owned" && !createBusy}
        className="relative flex min-h-0 min-w-0 flex-1"
        onFiles={(_files, transfer) =>
          treeModel.onExternalDropFiles(
            readDroppedUploadSources(transfer),
            ownedFolderId,
          )
        }
        outlined
        testId="workspace-file-drop-target"
        title={t(m.releaseToUploadTo, {
          folder: (ownedFolderId && trail.at(-1)?.name) || t(m.myPages),
        })}
      >
        <main
          className="workspace-content-viewport workspace-scrollbar min-w-0 flex-1 overflow-y-auto bg-app-surface [scrollbar-gutter:stable]"
          data-testid="library-document-scroll"
        >
          <div className="workspace-file-browser">
            <LibraryDocumentsHeader
              createBusy={createBusy}
              importRef={treeModel.importRef}
              onCreateDocument={() => treeModel.onCreateDocument(ownedFolderId)}
              onImport={(file) => {
                if (tab !== "owned") chooseTab("owned");
                treeModel.onImport(file, ownedFolderId);
              }}
              onImportPick={() => treeModel.onImportPick(ownedFolderId)}
              onNewFolder={() => setCreatingFolder(true)}
              onUploadFolder={(files) => {
                if (tab !== "owned") chooseTab("owned");
                treeModel.onUploadFolder(files, ownedFolderId);
              }}
            />
            <nav
              aria-label={t(m.libraryTimeViews)}
              className="mb-5 flex flex-wrap items-center gap-2"
            >
              <Link
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={dayReviewPath(tenantId)}
              >
                <Icon icon={Calendar03Icon} size={14} />
                {t(m.thisDay)}
              </Link>
              <Link
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={libraryWeekPath(tenantId)}
              >
                <Icon icon={Clock01Icon} size={14} />
                {t(m.whatChangedThisWeek)}
              </Link>
            </nav>
            <RecentDocumentCards
              documentActions={documentActions}
              documents={recentDocuments}
              error={recent.error}
              pending={recent.isPending}
              tenantId={tenantId}
            />
            <WorkspaceTabs onChange={chooseTab} value={tab} />
            <LibraryUploadSummary uploads={treeModel.pendingUploads} />
            {tab === "meetings" ? (
              <MeetingsPanel tenantId={tenantId} />
            ) : (
              <>
                <RecentDocumentsStrip tenantId={tenantId} />
                <LibraryFolderListing
                  activeView={activeView}
                  browsedError={browsedTree.error}
                  browsedPending={browsedTree.isPending}
                  bulkBar={
                    <LibraryBulkBar
                      canCopy={copyDocuments.length > 0}
                      canMove={bulk.canMove}
                      canTrash={bulk.canTrash}
                      count={bulk.count}
                      onClear={bulk.clear}
                      onCopyLinks={() => void bulk.copyLinks(copyDocuments)}
                      onMove={bulk.beginMove}
                      onTrash={bulk.beginTrash}
                      outcome={bulk.outcome}
                      pending={bulk.pending}
                    />
                  }
                  documentActions={documentActions}
                  documents={levelDocuments}
                  emptyActions={
                    tab === "owned"
                      ? {
                          busy: createBusy,
                          onCreateDocument: () =>
                            treeModel.onCreateDocument(ownedFolderId),
                          onImportPick: () =>
                            treeModel.onImportPick(ownedFolderId),
                        }
                      : undefined
                  }
                  error={treeModel.error}
                  failedUploads={treeModel.failedUploads}
                  fileType={fileType}
                  folderActions={
                    tab === "owned"
                      ? {
                          busy: Boolean(treeModel.deletingFolderId),
                          onDelete: treeModel.onDeleteFolder,
                          onMove: treeModel.onMoveBegin,
                          onRename: treeModel.onBeginRename,
                        }
                      : undefined
                  }
                  folderId={folderId}
                  folders={openedFolder.folders}
                  onClearFilters={() => {
                    setFileType("");
                    setSearchQuery("");
                  }}
                  onCopy={copy.beginCopy}
                  onDismissError={treeModel.onDismissError}
                  onDismissFailedUpload={treeModel.onDismissFailedUpload}
                  onFileTypeChange={setFileType}
                  onOpenFolder={openFolder}
                  onRetryAllFailedUploads={treeModel.onRetryAllFailedUploads}
                  onRetryFailedUpload={treeModel.onRetryFailedUpload}
                  onSearchQueryChange={setSearchQuery}
                  onSortByChange={setSortBy}
                  onToggleSelected={bulk.toggle}
                  pendingUploads={treeModel.pendingUploads}
                  searchQuery={searchQuery}
                  selectedDocumentIds={bulk.selectedDocumentIds}
                  sortBy={sortBy}
                  tab={tab}
                  tenantId={tenantId}
                  trail={trail}
                  uploadsActive={Boolean(treeModel.creating)}
                />
              </>
            )}
          </div>
        </main>
      </FileDropTarget>
    </div>
  );
}

/** The actions offered while Library rows are selected, with the last outcome. */
function LibraryBulkBar({
  canCopy,
  canMove,
  canTrash,
  count,
  onClear,
  onCopyLinks,
  onMove,
  onTrash,
  outcome,
  pending,
}: {
  canCopy: boolean;
  canMove: boolean;
  canTrash: boolean;
  count: number;
  onClear: () => void;
  onCopyLinks: () => void;
  onMove: () => void;
  onTrash: () => void;
  outcome: LibraryBulkOutcome | null;
  pending: boolean;
}) {
  const t = useT();
  if (count === 0 && !outcome) return null;
  return (
    <div
      aria-label={t(m.selectedDocuments)}
      className="flex flex-wrap items-center gap-2 border-b border-app-border pb-2 text-sm"
      role="group"
    >
      {count > 0 ? (
        <span className="text-app-body">{t(m.selectedCount, { count })}</span>
      ) : null}
      <Button
        disabled={pending || !canMove}
        onClick={onMove}
        size="compact"
        tone="secondary"
      >
        {t(m.moveToFolder)}
      </Button>
      <Button
        data-voice-risk="never"
        disabled={pending || !canTrash}
        onClick={onTrash}
        size="compact"
        tone="danger"
      >
        {t(commonMessages.delete)}
      </Button>
      <Button
        disabled={pending || !canCopy}
        onClick={onCopyLinks}
        size="compact"
        tone="secondary"
      >
        {t(m.copyLinks)}
      </Button>
      {count > 0 ? (
        <Button onClick={onClear} size="compact" tone="ghost">
          {t(m.clearSelection)}
        </Button>
      ) : null}
      {outcome ? (
        <p
          className={outcome.failed ? "text-app-danger" : "text-app-muted"}
          role={outcome.failed ? "alert" : "status"}
        >
          {outcome.message}
        </p>
      ) : null}
    </div>
  );
}

/** The personal tree behind My pages, with the same model the sidebar tree uses. */
function useOwnedDocumentTree(client: TeamHubClient, tenantId: string) {
  const queryClient = useQueryClient();
  const tree = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/me/document-tree", {
          params: { path: { tenantId } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "document-tree"],
    staleTime: 60_000,
  });
  // One reread covers both the tree and the smart view every Library list builds on.
  function reload() {
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["teamhub", tenantId, "document-tree"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["teamhub", "library-documents"],
      }),
    ]);
  }
  const treeModel = useMyDocumentsTreeModel({
    collapseFoldersInitially: true,
    items: tree.data?.items ?? [],
    loadError: tree.error,
    onChanged: reload,
    pending: tree.isPending,
    tenantId,
  });
  return { reload, tree, treeModel };
}

function DocumentHistoryDialog({
  client,
  documentId,
  onClose,
  tenantId,
}: {
  client: TeamHubClient;
  documentId: string;
  onClose: () => void;
  tenantId: string;
}) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center gap-2 py-8 text-sm text-app-muted"
          role="status"
        >
          <Spinner size={16} />
          {t(m.loadingHistory)}
        </div>
      }
    >
      <UnifiedDocumentTimelineDialog
        client={client}
        documentId={documentId}
        tenantId={tenantId}
        onClose={onClose}
      />
    </Suspense>
  );
}

function copyDocumentLink(
  document: TeamHubDocumentTreeSummary,
  tenantId: string,
) {
  const url = new URL(
    documentDetailPath({ documentId: document.id, tenantId }),
    window.location.origin,
  ).toString();
  return writeDocumentLinkClipboard({
    documentId: document.id,
    tenantId,
    title: document.title,
    url,
  });
}

export function MyDocumentsTree(props: MyDocumentsTreeProps) {
  return (
    <div className="space-y-1">
      <MyDocumentsTreeView
        {...useMyDocumentsTreeModel(props)}
        collapseCollectionInitially={props.collapseCollectionInitially}
      />
      <SharedDocumentsTree
        activeDocumentId={props.activeDocumentId}
        tenantId={props.tenantId}
      />
    </div>
  );
}
