import {
  FileAddIcon,
  FileImportIcon,
  Folder01Icon,
  FolderAddIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Spinner } from "@/components/ui/spinner";
import type {
  TeamHubDocumentPlacementNode,
  TeamHubDocumentTreeSummary,
} from "@/features/teamhub/teamhub-types";
import { useT } from "@/i18n/use-translation";

import { DocumentDeleteDialog } from "./document-delete-dialog";
import { documentFileName } from "./document-display-name";
import { libraryMessages as m } from "./library.messages";
import {
  readDroppedUploadSources,
  type UploadBatch,
} from "./library-upload-queue";
import { MoveFolderPickerDialog } from "./move-folder-picker-dialog";
import {
  type DocumentTreeFolder,
  isExternalFileTransfer,
  isFolderMoveCycle,
} from "./my-documents-tree-helpers";
import { renderTreeLevel } from "./my-documents-tree-level";
import { useDocumentRename } from "./use-document-rename";
import type { MyDocumentsTreeModel } from "./use-my-documents-tree-model";
import {
  WORKSPACE_HEADING_ICON_SIZE,
  workspaceHeadingActionClass,
  workspaceHeadingToggleClass,
} from "./workspace-sidebar-styles";

/** The Owned by Me collection, collapsible as a whole, beside an opened Document. */
export function MyDocumentsTreeView({
  collapseCollectionInitially = false,
  ...model
}: MyDocumentsTreeModel & {
  collapseCollectionInitially?: boolean;
}) {
  const rename = useDocumentRename(model.tenantId);
  const { collectionCollapsed, revealCollection, toggleCollection } =
    useOwnedCollectionCollapsed(
      model.tenantId,
      collapseCollectionInitially,
      model.items.some(
        (item) =>
          item.node_kind === "document" &&
          item.document_id === model.activeDocumentId,
      ),
    );

  const confirmingDeleteFolder = model.confirmingDeleteFolderId
    ? model.folders.find(
        (folder) => folder.id === model.confirmingDeleteFolderId,
      )
    : undefined;
  const deletingFolderPending = Boolean(model.deletingFolderId);

  return (
    <OwnedDocumentDropZone
      onCancel={model.onExternalDropCancel}
      onEnter={() => model.onExternalDropEnter()}
      onFiles={model.onExternalDropFiles}
    >
      {model.trashingDocument ? (
        <DocumentDeleteDialog
          error={model.error}
          onCancel={model.onTrashCancel}
          onConfirm={model.onTrashConfirm}
          pending={model.trashPending}
          title={model.trashingDocument.title}
        />
      ) : null}
      {confirmingDeleteFolder ? (
        <ModalDialog
          closeOnBackdrop={!deletingFolderPending}
          description={
            <>
              Delete <strong>{confirmingDeleteFolder.name}</strong>? This action
              cannot be undone.
            </>
          }
          footer={
            <>
              <Button
                disabled={deletingFolderPending}
                onClick={model.onCancelDeleteFolder}
                tone="secondary"
              >
                Cancel
              </Button>
              <Button
                loading={deletingFolderPending}
                onClick={model.onConfirmDeleteFolder}
                tone="danger"
              >
                Delete folder
              </Button>
            </>
          }
          onClose={model.onCancelDeleteFolder}
          size="sm"
          title="Delete folder"
        >
          {null}
        </ModalDialog>
      ) : null}
      <OwnedTreeHeading
        collectionCollapsed={collectionCollapsed}
        createDisabled={
          Boolean(model.creating) || model.pending || Boolean(model.loadError)
        }
        onCreateDocument={() => {
          revealCollection();
          model.onCreateDocument();
        }}
        onCreateFolder={() => {
          revealCollection();
          model.onCreateFolder();
        }}
        onImportPick={() => {
          revealCollection();
          model.onImportPick();
        }}
        onToggleCollection={toggleCollection}
      />
      <input
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const parentId = model.importTargetRef.current;
          model.importTargetRef.current = undefined;
          if (file) model.onImport(file, parentId);
        }}
        ref={model.importRef}
        type="file"
      />
      {!collectionCollapsed ? (
        <OwnedTreeBody model={model} onRenameDocument={rename.beginRename} />
      ) : null}
      {rename.dialog}
    </OwnedDocumentDropZone>
  );
}

/**
 * Collapse state of the whole collection, kept in session storage per tenant.
 * Creating or importing into a collapsed collection would otherwise hide the
 * new entry, so those paths reveal it.
 */
function useOwnedCollectionCollapsed(
  tenantId: string,
  collapseCollectionInitially: boolean,
  holdsActiveDocument: boolean,
) {
  const collectionCollapsedKey = collapseCollectionInitially
    ? `linger:library-owned-collapsed:v2:${tenantId}`
    : `linger:library-owned-collapsed:${tenantId}`;
  const [collectionCollapsed, setCollectionCollapsed] = useState(() =>
    collapseCollectionInitially
      ? window.sessionStorage.getItem(collectionCollapsedKey) !== "false"
      : window.sessionStorage.getItem(collectionCollapsedKey) === "true",
  );
  useLayoutEffect(() => {
    setCollectionCollapsed(
      collapseCollectionInitially
        ? window.sessionStorage.getItem(collectionCollapsedKey) !== "false"
        : window.sessionStorage.getItem(collectionCollapsedKey) === "true",
    );
  }, [collapseCollectionInitially, collectionCollapsedKey]);
  // A Document opened in the Library shows where it is kept.
  useEffect(() => {
    if (!holdsActiveDocument) return;
    window.sessionStorage.setItem(collectionCollapsedKey, "false");
    setCollectionCollapsed(false);
  }, [collectionCollapsedKey, holdsActiveDocument]);
  function toggleCollection() {
    const next = !collectionCollapsed;
    window.sessionStorage.setItem(collectionCollapsedKey, String(next));
    setCollectionCollapsed(next);
  }

  function revealCollection() {
    window.sessionStorage.setItem(collectionCollapsedKey, "false");
    setCollectionCollapsed(false);
  }
  return { collectionCollapsed, revealCollection, toggleCollection };
}

function OwnedTreeHeading({
  collectionCollapsed,
  createDisabled,
  onCreateDocument,
  onCreateFolder,
  onImportPick,
  onToggleCollection,
}: {
  collectionCollapsed: boolean;
  createDisabled: boolean;
  onCreateDocument: () => void;
  onCreateFolder: () => void;
  onImportPick: () => void;
  onToggleCollection: () => void;
}) {
  const t = useT();
  return (
    <div className="document-tree-heading flex items-center justify-between gap-1">
      <button
        aria-expanded={!collectionCollapsed}
        aria-label={t(collectionCollapsed ? m.expandOwned : m.collapseOwned)}
        className={workspaceHeadingToggleClass}
        onClick={onToggleCollection}
        type="button"
      >
        <Icon
          icon={Folder01Icon}
          className="shrink-0 text-app-muted"
          size={WORKSPACE_HEADING_ICON_SIZE}
        />
        <span className="truncate">{t(m.myPages)}</span>
      </button>
      <ActionMenu
        placement="right-start"
        buttonClassName={workspaceHeadingActionClass}
        items={[
          {
            children: [{ label: "md", onSelect: onCreateDocument }],
            disabled: createDisabled,
            icon: <Icon icon={FileAddIcon} size={14} />,
            label: t(m.newFile),
          },
          {
            disabled: createDisabled,
            icon: <Icon icon={FolderAddIcon} size={14} />,
            label: t(m.newFolder),
            onSelect: onCreateFolder,
          },
          {
            disabled: createDisabled,
            icon: <Icon icon={FileImportIcon} size={14} />,
            label: t(m.importFile),
            onSelect: onImportPick,
          },
        ]}
        label={t(m.createInOwned)}
        trigger={
          <Icon icon={PlusSignIcon} size={WORKSPACE_HEADING_ICON_SIZE} />
        }
      />
    </div>
  );
}

function OwnedTreeBody({
  model,
  onRenameDocument,
}: {
  model: MyDocumentsTreeModel;
  onRenameDocument: (document: TeamHubDocumentTreeSummary) => void;
}) {
  const t = useT();
  const { movingPlacement } = model;
  return (
    <>
      {model.error ? (
        <p className="px-1 py-2 text-xs text-app-danger" role="alert">
          {model.error}
        </p>
      ) : null}
      {movingPlacement ? (
        <MovePlacementDialog
          folders={model.folders}
          items={model.items}
          label={
            movingPlacement.node_kind === "folder"
              ? movingPlacement.name
              : (() => {
                  const movingDocument = model.documentsById.get(
                    movingPlacement.document_id,
                  );
                  return movingDocument
                    ? documentFileName(movingDocument)
                    : undefined;
                })()
          }
          onCancel={model.onMoveCancel}
          onMove={(parentId) => model.onMove(movingPlacement, parentId)}
          placement={movingPlacement}
        />
      ) : null}
      {model.loadError ? (
        <p className="px-1 py-3 text-xs text-app-danger" role="alert">
          {model.loadError.message || t(m.treeUnavailable)}
        </p>
      ) : model.pending ? (
        <p className="flex items-center gap-2 px-1 py-3 text-xs text-app-muted">
          <Spinner size={14} />
          {t(m.loadingTree)}
        </p>
      ) : (
        <>
          {model.items.length === 0 && model.pendingUploads.length === 0 ? (
            <p className="py-3 pl-[30px] pr-2 text-xs text-muted-foreground">
              {t(m.noDocumentsYet)}
            </p>
          ) : (
            // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- composite widget: focus is managed on its child items
            <div
              aria-label={t(m.ownedByMe)}
              className="mt-2 ml-4"
              onKeyDown={model.onTreeKeyDown}
              role="tree"
            >
              {renderTreeLevel({
                activeDocumentId: model.activeDocumentId,
                collapsed: model.collapsed,
                deletingFolderId: model.deletingFolderId,
                documentsById: model.documentsById,
                focusedNodeId: model.focusedNodeId,
                folders: model.folders,
                items: model.items,
                onBeginRename: model.onBeginRename,
                onRenameDocument,
                onCopyLink: model.onCopyLink,
                onCreateDocument: model.onCreateDocument,
                onCreateFolder: model.onCreateFolder,
                onDeleteFolder: model.onDeleteFolder,
                onDuplicateDocument: model.onDuplicateDocument,
                onExportDocument: model.onExportDocument,
                onFocusNode: model.onFocusNode,
                onImportPick: model.onImportPick,
                onExternalDropCancel: model.onExternalDropCancel,
                onExternalDropEnter: model.onExternalDropEnter,
                onExternalDropFiles: model.onExternalDropFiles,
                externalDrop: model.externalDrop,
                onMove: model.onMove,
                onMoveBegin: model.onMoveBegin,
                onRenameCancel: model.onRenameCancel,
                onRenameChange: model.onRenameChange,
                onRenameSubmit: model.onRenameSubmit,
                onToggle: model.onToggle,
                onTrashDocument: model.onTrashDocument,
                parentId: undefined,
                pendingUploads: model.pendingUploads,
                revealDocumentId: model.revealDocumentId,
                renamingFolder: model.renamingFolder,
                t,
                tenantId: model.tenantId,
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

function OwnedDocumentDropZone({
  children,
  onCancel,
  onEnter,
  onFiles,
}: {
  children: ReactNode;
  onCancel: () => void;
  onEnter: () => void;
  onFiles: (batch: Promise<UploadBatch>) => void;
}) {
  const t = useT();
  return (
    <section
      aria-label={t(m.ownedTree)}
      onDragEnter={(event) => {
        if (!isExternalFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        onEnter();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        onCancel();
      }}
      onDragOver={(event) => {
        if (!isExternalFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (!isExternalFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        onFiles(readDroppedUploadSources(event.dataTransfer));
      }}
    >
      {children}
    </section>
  );
}

function MovePlacementDialog({
  folders,
  items,
  label,
  onCancel,
  onMove,
  placement,
}: {
  folders: DocumentTreeFolder[];
  items: TeamHubDocumentPlacementNode[];
  /** The name of what moves; a Document that is no longer listed has none. */
  label: string | undefined;
  onCancel: () => void;
  onMove: (parentId: string) => void;
  placement: TeamHubDocumentPlacementNode;
}) {
  const t = useT();
  const disabledFolderIds = new Set<string>();
  if (placement.node_kind === "folder") {
    for (const folder of folders) {
      if (isFolderMoveCycle(placement.id, folder.id, items)) {
        disabledFolderIds.add(folder.id);
      }
    }
  }
  return (
    <MoveFolderPickerDialog
      currentParentId={placement.parent_id}
      disabledFolderIds={disabledFolderIds}
      folders={folders}
      label={label}
      onCancel={onCancel}
      onMove={onMove}
      rootLabel={t(m.ownedByMe)}
    />
  );
}
