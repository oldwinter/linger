export function markMomentPath(tenantId: string, documentId: string) {
  return `/t/${encodeURIComponent(tenantId)}/documents/${encodeURIComponent(documentId)}/mark`;
}
