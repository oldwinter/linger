import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { FileDropTarget } from "@/components/ui/file-drop-target";
import { Spinner } from "@/components/ui/spinner";
import { writeDocumentLinkClipboard } from "@/features/rooms/files/document-clipboard-link";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import type { RoomDocumentMenuActions } from "@/features/rooms/documents/room-document-actions-menu";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocumentTreeSummary } from "@/features/teamhub/teamhub-types";
import { MeetingsPanel } from "@/features/memory/meetings-panel";

import {
  CopyToMyDocumentsDialog,
  useCopyToMyDocuments,
} from "./copy-to-my-documents-dialog";
import { DocumentDeleteDialog } from "./document-delete-dialog";
import { documentFileName } from "./document-display-name";
import { RecentDocumentCards } from "./library-document-results";
import { LibraryDocumentsHeader } from "./library-documents-header";
import { NewFolderDialog } from "./library-folder-browser";
import { LibraryFolderListing } from "./library-folder-listing";
import { MoveFolderPickerDialog } from "./move-folder-picker-dialog";
import { readDroppedUploadSources } from "./library-upload-queue";
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
  const [sortBy, setSortBy] = useState("updated");
  const copy = useCopyToMyDocuments(client, tenantId);
  const { tree, treeModel, reload } = useOwnedDocumentTree(client, tenantId);
  const treeItems = tree.data?.items ?? [];
  const [creatingFolder, setCreatingFolder] = useState(false);
  const { browsedTree, folderId, levelDocuments, openedFolder, trail } =
    useLibraryFolderLevel({
      client,
      fileType,
      requestedFolder: searchParams.get("folder"),
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
  function chooseTab(next: WorkspaceTab) {
    // A selection belongs to the folder level it was made in.
    bulk.clear();
    setSearchParams(next === "owned" ? {} : { tab: next }, { replace: true });
  }
  // An open folder also lives in the URL, so Back leaves the folder.
  function openFolder(nextFolderId?: string) {
    bulk.clear();
    setSearchParams({
      ...(tab === "owned" ? {} : { tab }),
      ...(nextFolderId ? { folder: nextFolderId } : {}),
    });
  }
  const ownedFolderId = tab === "owned" ? folderId : undefined;
  const recent = useLibraryDocuments("recent", true);
  const recentDocuments = (recent.data?.pages[0]?.items ?? []).slice(
    0,
    RECENT_CARD_LIMIT,
  );
  const activeView =
    workspaceTabs.find((candidate) => candidate.id === tab) ?? workspaceTabs[0];
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

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {copy.copyingDocument ? (
        <CopyToMyDocumentsDialog
          document={copy.copyingDocument}
          error={copy.copyError}
          folders={
            tree.data?.items.filter(
              (item): item is DocumentTreeFolder => item.node_kind === "folder",
            ) ?? []
          }
          items={tree.data?.items ?? []}
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
          defaultName={nextFolderName(treeItems, ownedFolderId)}
          onCancel={() => setCreatingFolder(false)}
          onCreate={async (name) => {
            await treeModel.onCreateNamedFolder(name, ownedFolderId);
            setCreatingFolder(false);
          }}
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
          folders={treeItems.filter(
            (item): item is DocumentTreeFolder => item.node_kind === "folder",
          )}
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
        title={`Release to upload to ${(ownedFolderId && trail.at(-1)?.name) || "My pages"}`}
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
              onImport={(file) => treeModel.onImport(file, ownedFolderId)}
              onImportPick={() => treeModel.onImportPick(ownedFolderId)}
              onNewFolder={() => setCreatingFolder(true)}
              onUploadFolder={(files) =>
                treeModel.onUploadFolder(files, ownedFolderId)
              }
            />
            <RecentDocumentCards
              documentActions={documentActions}
              documents={recentDocuments}
              error={recent.error}
              pending={recent.isPending}
              tenantId={tenantId}
            />
            <WorkspaceTabs onChange={chooseTab} value={tab} />
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
                      canMove={bulk.canMove}
                      canTrash={bulk.canTrash}
                      count={bulk.count}
                      onClear={bulk.clear}
                      onMove={bulk.beginMove}
                      onTrash={bulk.beginTrash}
                      outcome={bulk.outcome}
                      pending={bulk.pending}
                    />
                  }
                  documentActions={documentActions}
                  documents={levelDocuments}
                  error={treeModel.error}
                  fileType={fileType}
                  folderId={folderId}
                  folders={openedFolder.folders}
                  onCopy={copy.beginCopy}
                  onDismissError={treeModel.onDismissError}
                  onFileTypeChange={setFileType}
                  onOpenFolder={openFolder}
                  onSortByChange={setSortBy}
                  onToggleSelected={bulk.toggle}
                  pendingUploads={treeModel.pendingUploads}
                  selectedDocumentIds={bulk.selectedDocumentIds}
                  sortBy={sortBy}
                  tab={tab}
                  tenantId={tenantId}
                  trail={trail}
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
  canMove,
  canTrash,
  count,
  onClear,
  onMove,
  onTrash,
  outcome,
  pending,
}: {
  canMove: boolean;
  canTrash: boolean;
  count: number;
  onClear: () => void;
  onMove: () => void;
  onTrash: () => void;
  outcome: LibraryBulkOutcome | null;
  pending: boolean;
}) {
  if (count === 0 && !outcome) return null;
  return (
    <div
      aria-label="Selected documents"
      className="flex flex-wrap items-center gap-2 border-b border-app-border pb-2 text-sm"
      role="group"
    >
      {count > 0 ? (
        <span className="text-app-body">{count} selected</span>
      ) : null}
      <Button
        disabled={pending || !canMove}
        onClick={onMove}
        size="compact"
        tone="secondary"
      >
        Move to folder
      </Button>
      <Button
        disabled={pending || !canTrash}
        onClick={onTrash}
        size="compact"
        tone="danger"
      >
        Trash
      </Button>
      {count > 0 ? (
        <Button onClick={onClear} size="compact" tone="ghost">
          Clear selection
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
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center gap-2 py-8 text-sm text-app-muted"
          role="status"
        >
          <Spinner size={16} />
          Loading history…
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
