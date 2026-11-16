/** A tree row, only as far as Back needs to find the open file's folder. */
interface LibraryBackItem {
  document_id?: string;
  node_kind: string;
  parent_id?: string;
}

/** Library home, or the folder that holds the open file. */
export function libraryFolderBackPath(
  tenantId: string,
  items: readonly LibraryBackItem[],
  documentId: string | undefined,
): string {
  const home = `/t/${encodeURIComponent(tenantId)}/library`;
  if (!documentId) return home;
  const placement = items.find(
    (item) => item.node_kind === "document" && item.document_id === documentId,
  );
  if (!placement?.parent_id) return home;
  return `${home}?folder=${encodeURIComponent(placement.parent_id)}`;
}
