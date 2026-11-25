import {
  ArrowRight01Icon,
  Delete02Icon,
  Folder01Icon,
  FolderExportIcon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { type FormEvent, useState } from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import type {
  TeamHubDocumentPlacementNode,
  TeamHubDocumentTreeSummary,
} from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { formatLocale } from "@/i18n/language";
import { RichMessage, useT, useTranslation } from "@/i18n/use-translation";
import { formatDateTime, formatUpdatedAt } from "@/lib/date-format";

import type { PendingDocumentUpload } from "./library-upload-queue";
import { libraryMessages as m } from "./library.messages";

export type LibraryFolder = Extract<
  TeamHubDocumentPlacementNode,
  { node_kind: "folder" }
>;

/** Folders and Documents placed directly in one My pages folder (root when undefined). */
export function folderChildren(
  items: readonly TeamHubDocumentPlacementNode[],
  folderId: string | undefined,
) {
  const folders: LibraryFolder[] = [];
  const documents: TeamHubDocumentTreeSummary[] = [];
  for (const item of items) {
    if (item.parent_id !== folderId) continue;
    if (item.node_kind === "folder") folders.push(item);
    else documents.push(item.document);
  }
  return { documents, folders };
}

/** Every Document below a folder (the whole tree when undefined), at any depth. */
export function folderDescendantDocuments(
  items: readonly TeamHubDocumentPlacementNode[],
  folderId: string | undefined,
) {
  const childrenByParent = new Map<
    string | undefined,
    TeamHubDocumentPlacementNode[]
  >();
  for (const item of items) {
    const siblings = childrenByParent.get(item.parent_id) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parent_id, siblings);
  }
  const documents: TeamHubDocumentTreeSummary[] = [];
  const pending = [...(childrenByParent.get(folderId) ?? [])];
  for (let item = pending.pop(); item; item = pending.pop()) {
    if (item.node_kind === "document") documents.push(item.document);
    else pending.push(...(childrenByParent.get(item.id) ?? []));
  }
  return documents;
}

/** Every Folder below a folder (the whole tree when undefined), at any depth. */
export function folderDescendantFolders(
  items: readonly TeamHubDocumentPlacementNode[],
  folderId: string | undefined,
) {
  const childrenByParent = new Map<
    string | undefined,
    TeamHubDocumentPlacementNode[]
  >();
  for (const item of items) {
    const siblings = childrenByParent.get(item.parent_id) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parent_id, siblings);
  }
  const folders: LibraryFolder[] = [];
  const pending = [...(childrenByParent.get(folderId) ?? [])];
  for (let item = pending.pop(); item; item = pending.pop()) {
    if (item.node_kind === "folder") {
      folders.push(item);
      pending.push(...(childrenByParent.get(item.id) ?? []));
    }
  }
  return folders;
}

/** The folder and its ancestors, outermost first; empty when the folder is gone. */
export function folderTrail(
  items: readonly TeamHubDocumentPlacementNode[],
  folderId: string | undefined,
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const trail: LibraryFolder[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current?.node_kind === "folder") {
    trail.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return trail;
}

export function LibraryFolderBreadcrumb({
  onOpen,
  rootLabel,
  trail,
}: {
  onOpen: (folderId?: string) => void;
  rootLabel: string;
  trail: readonly LibraryFolder[];
}) {
  const t = useT();
  return (
    <nav
      aria-label={t(m.folderPath)}
      className="mb-3 flex flex-wrap items-center gap-1 text-sm"
    >
      <button
        className="rounded-md px-1.5 py-0.5 text-app-muted hover:bg-app-hover hover:text-app-body"
        onClick={() => onOpen(undefined)}
        type="button"
      >
        {rootLabel}
      </button>
      {trail.map((folder, index) => (
        <span className="flex min-w-0 items-center gap-1" key={folder.id}>
          <Icon className="text-app-muted" icon={ArrowRight01Icon} size={14} />
          {index === trail.length - 1 ? (
            <span aria-current="page" className="truncate px-1.5 font-medium">
              {folder.name}
            </span>
          ) : (
            <button
              className="truncate rounded-md px-1.5 py-0.5 text-app-muted hover:bg-app-hover hover:text-app-body"
              onClick={() => onOpen(folder.id)}
              type="button"
            >
              {folder.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

export interface LibraryFolderRowActions {
  busy?: boolean;
  onDelete: (folderId: string) => void;
  onMove: (folder: LibraryFolder) => void;
  onRename: (folder: LibraryFolder) => void;
}

export function LibraryFolderRow({
  actions,
  folder,
  onOpen,
}: {
  actions?: LibraryFolderRowActions;
  folder: LibraryFolder;
  onOpen: (folderId: string) => void;
}) {
  const translation = useTranslation();
  const { t } = translation;
  const exactTitle = Number.isFinite(Date.parse(folder.updated_at))
    ? formatDateTime(
        folder.updated_at,
        undefined,
        formatLocale(translation.language),
      )
    : undefined;
  return (
    <div className="workspace-file-row">
      <button
        aria-label={t(m.openFolder, { name: folder.name })}
        className="workspace-file-name text-left"
        onClick={() => onOpen(folder.id)}
        type="button"
      >
        <span className="workspace-file-icon bg-muted text-muted-foreground">
          <Icon icon={Folder01Icon} size={18} />
        </span>
        <span className="min-w-0">
          <strong>{folder.name}</strong>
          <span className="workspace-file-context">{t(m.folder)}</span>
        </span>
      </button>
      <div className="workspace-file-metadata">
        <time dateTime={folder.updated_at} title={exactTitle}>
          {formatUpdatedAt(folder.updated_at, undefined, translation)}
        </time>
      </div>
      {actions ? (
        <ActionMenu
          buttonClassName="workspace-file-action"
          items={[
            {
              disabled: actions.busy,
              icon: <Icon icon={PencilEdit01Icon} size={14} />,
              label: t(m.rename),
              onSelect: () => actions.onRename(folder),
            },
            {
              disabled: actions.busy,
              icon: <Icon icon={FolderExportIcon} size={14} />,
              label: t(m.move),
              onSelect: () => actions.onMove(folder),
            },
            {
              danger: true,
              disabled: actions.busy,
              icon: <Icon icon={Delete02Icon} size={14} />,
              label: t(commonMessages.delete),
              onSelect: () => actions.onDelete(folder.id),
              separatorBefore: true,
              voiceRisk: "never",
            },
          ]}
          label={t(m.actionsFor, { name: folder.name })}
          placement="bottom-end"
          trigger={<Icon icon={MoreHorizontalIcon} size={14} />}
        />
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

/** A compact queue summary that survives leaving and reopening the Library. */
export function LibraryUploadSummary({
  uploads,
}: {
  uploads: readonly PendingDocumentUpload[];
}) {
  const t = useT();
  if (uploads.length === 0) return null;
  const current = uploads.find((upload) => upload.status === "uploading");
  const percent = Math.round((current?.progress ?? 0) * 100);
  return (
    <div
      aria-label={t(m.uploadProgress)}
      className="mb-2 rounded-lg border border-app-border px-3 py-2 text-xs text-app-muted"
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate">
          {current
            ? t(m.uploadingFile, { filename: current.filename })
            : t(m.preparingUpload)}
        </span>
        <span className="shrink-0">
          {t(m.filesLeft, { count: uploads.length })}
        </span>
      </div>
      <div
        aria-label={t(m.currentFileUpload)}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function NewFolderDialog({
  defaultName,
  onCancel,
  onCreate,
}: {
  defaultName: string;
  onCancel: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(defaultName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      await onCreate(trimmed);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t(m.folderNotCreated),
      );
      setPending(false);
    }
  }

  return (
    <ModalDialog
      closeOnBackdrop={!pending}
      footer={
        <>
          <Button disabled={pending} onClick={onCancel} tone="secondary">
            {t(commonMessages.cancel)}
          </Button>
          <Button
            disabled={!trimmed}
            loading={pending}
            onClick={() => void submit()}
            tone="primary"
          >
            {t(m.create)}
          </Button>
        </>
      }
      onClose={() => {
        if (!pending) onCancel();
      }}
      size="sm"
      title={t(m.newFolder)}
    >
      <form className="px-5 py-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium text-app-body">
          {t(m.folderName)}
          <input
            aria-label={t(m.folderName)}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the field is focused on purpose because the user just opened this dialog or inline editor
            autoFocus
            className="mt-1 h-9 w-full rounded-md border border-app-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            value={name}
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-app-danger" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}

export function RenameFolderDialog({
  error,
  name,
  onCancel,
  onChange,
  onSubmit,
}: {
  error: string | null;
  name: string;
  onCancel: () => void;
  onChange: (name: string) => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const trimmed = name.trim();

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed) return;
    onSubmit();
  }

  return (
    <ModalDialog
      footer={
        <>
          <Button onClick={onCancel} tone="secondary">
            {t(commonMessages.cancel)}
          </Button>
          <Button disabled={!trimmed} onClick={() => submit()} tone="primary">
            {t(commonMessages.save)}
          </Button>
        </>
      }
      onClose={onCancel}
      size="sm"
      title={t(m.renameFolder)}
    >
      <form className="px-5 py-4" onSubmit={submit}>
        <label className="block text-sm font-medium text-app-body">
          {t(m.folderName)}
          <input
            aria-label={t(m.folderName)}
            className="mt-1 h-9 w-full rounded-md border border-app-border bg-transparent px-3 text-sm placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={255}
            onChange={(event) => onChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) {
                event.stopPropagation();
              }
            }}
            value={name}
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-app-danger" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}

export function DeleteFolderDialog({
  name,
  onCancel,
  onConfirm,
  pending,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const t = useT();
  return (
    <ModalDialog
      closeOnBackdrop={!pending}
      description={
        <RichMessage
          message={m.deleteFolderBody}
          tags={{ name: (text) => <strong>{text}</strong> }}
          values={{ name }}
        />
      }
      footer={
        <>
          <Button disabled={pending} onClick={onCancel} tone="secondary">
            {t(commonMessages.cancel)}
          </Button>
          <Button
            data-voice-risk="never"
            loading={pending}
            onClick={onConfirm}
            tone="danger"
          >
            {t(m.deleteFolderConfirm)}
          </Button>
        </>
      }
      onClose={() => {
        if (!pending) onCancel();
      }}
      size="sm"
      title={t(m.deleteFolderTitle)}
    >
      {null}
    </ModalDialog>
  );
}
