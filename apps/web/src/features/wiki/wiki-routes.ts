import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";

/** Where a published Wiki page opens: its read-only Document route. */
export function wikiDocumentPath(tenantId: string, documentId: string) {
  return documentDetailPath({ documentId, tenantId });
}

/** Where a Wiki page the running refresh has written but not published opens. */
export function wikiPreviewPath(tenantId: string, path: string) {
  return `/t/${encodeURIComponent(tenantId)}/wiki-preview?page=${encodeURIComponent(path)}`;
}
