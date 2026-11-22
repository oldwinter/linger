import type { QueryClient } from "@tanstack/react-query";

import type { TeamHubDocumentPlacementNode } from "@/features/teamhub/teamhub-types";
import { type Translate, translate } from "@/i18n/language";

import { documentFileName } from "./document-display-name";
import type {
  TenantUploadError,
  UploadErrorText,
  UploadFailure,
} from "./library-upload-queue";
import { libraryMessages as m } from "./library.messages";

export type DocumentTreeFolder = Extract<
  TeamHubDocumentPlacementNode,
  { node_kind: "folder" }
>;
export interface ExternalDocumentDrop {
  parentId?: string;
}
interface MyDocumentTreeCache {
  items: TeamHubDocumentPlacementNode[];
}
export const personalPlacementDragType = "application/x-linger-placement";

export function myDocumentTreeQueryKey(tenantId: string) {
  return ["teamhub", tenantId, "document-tree"] as const;
}

/** Applies an optimistic tree change and returns its rollback. */
export function updateMyDocumentTreeCache(
  queryClient: QueryClient,
  treeQueryKey: ReturnType<typeof myDocumentTreeQueryKey>,
  update: (
    items: TeamHubDocumentPlacementNode[],
  ) => TeamHubDocumentPlacementNode[],
) {
  const previous = queryClient.getQueryData<MyDocumentTreeCache>(treeQueryKey);
  if (previous) {
    queryClient.setQueryData<MyDocumentTreeCache>(treeQueryKey, {
      ...previous,
      items: update(previous.items),
    });
  }
  return () => {
    if (previous) queryClient.setQueryData(treeQueryKey, previous);
  };
}

export function isFolderMoveCycle(
  sourceId: string,
  targetId: string,
  items: TeamHubDocumentPlacementNode[],
) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  let currentId: string | undefined = targetId;
  while (currentId !== undefined) {
    if (currentId === sourceId) return true;
    currentId = itemsById.get(currentId)?.parent_id;
  }
  return false;
}

/**
 * The name a new folder starts with, in the language on screen. Once the
 * folder exists the name is its own and no longer follows the language.
 */
export function nextFolderName(
  items: readonly TeamHubDocumentPlacementNode[],
  parentId?: string,
  t: Translate = translate,
) {
  const rootNames = new Set(
    items
      .filter(
        (item): item is DocumentTreeFolder =>
          item.node_kind === "folder" && item.parent_id === parentId,
      )
      .map((item) => item.name.toLocaleLowerCase()),
  );
  const name = t(m.defaultFolderName);
  if (!rootNames.has(name.toLocaleLowerCase())) return name;
  for (let index = 2; ; index += 1) {
    const candidate = t(m.defaultFolderNameNumbered, { index });
    if (!rootNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export function usedDocumentFilenames(
  items: readonly TeamHubDocumentPlacementNode[],
  parentId?: string,
) {
  return new Set(
    items
      .filter(
        (
          item,
        ): item is Extract<
          TeamHubDocumentPlacementNode,
          { node_kind: "document" }
        > => item.parent_id === parentId && item.node_kind === "document",
      )
      .map((item) => documentFileName(item.document).toLocaleLowerCase()),
  );
}

/** Folder names are unique case-insensitively in TeamHub, so paths are too. */
export function folderKey(path: readonly string[]) {
  return path.join("/").toLocaleLowerCase();
}

export function nextAvailableFolderName(
  name: string,
  usedNames: ReadonlySet<string>,
) {
  if (!usedNames.has(name.toLocaleLowerCase())) return name;
  for (let index = 2; ; index += 1) {
    const candidate = `${name} (${index})`;
    if (!usedNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** Words a kept upload error in the language on screen. */
export function uploadErrorText(
  error: TenantUploadError,
  t: Translate = translate,
) {
  if (typeof error === "string") return error;
  return "failures" in error
    ? uploadFailureMessage(error.failures, t)
    : t(error);
}

export function uploadFailureMessage(
  failures: readonly UploadFailure[],
  t: Translate = translate,
) {
  const worded = (text: UploadErrorText) =>
    typeof text === "string" ? text : t(text);
  const [first] = failures;
  const message = worded(first!.message);
  if (failures.length === 1) {
    return t(m.uploadFailure, { filename: first!.filename, message });
  }
  // File names, listed as they are.
  const names = failures
    .slice(0, 3)
    .map((failure) => failure.filename)
    .join(", ");
  const more = failures.length - 3;
  return more > 0
    ? t(m.uploadFailuresMore, {
        count: failures.length,
        message,
        more,
        names,
      })
    : t(m.uploadFailures, { count: failures.length, message, names });
}

export function nextAvailableUploadFilename(
  filename: string,
  usedNames: Set<string>,
) {
  const normalized = filename.toLocaleLowerCase();
  if (!usedNames.has(normalized)) return filename;
  const extensionIndex = filename.lastIndexOf(".");
  const basename =
    extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  for (let index = 2; ; index += 1) {
    const candidate = `${basename} (${index})${extension}`;
    if (!usedNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export function isExternalFileTransfer(transfer: DataTransfer) {
  return Array.from(transfer.types).includes("Files");
}

export function hasDragType(transfer: DataTransfer, type: string) {
  return Array.from(transfer.types).includes(type);
}

export async function runSequentially<T>(
  items: readonly T[],
  operation: (item: T, index: number) => Promise<void>,
  index = 0,
): Promise<void> {
  const item = items[index];
  if (item === undefined) return;
  await operation(item, index);
  await runSequentially(items, operation, index + 1);
}

export function nextPaint() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 16));
}
