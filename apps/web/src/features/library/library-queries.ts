export const libraryDocumentsQueryRoot = [
  "teamhub",
  "library-documents",
] as const;

export function libraryDocumentsTenantQueryKey(tenantId: string) {
  return ["teamhub", "library-documents", tenantId] as const;
}

export function libraryDocumentsQueryKey<V extends string>(
  tenantId: string,
  view: V,
) {
  return ["teamhub", "library-documents", tenantId, view] as const;
}

export function myDocumentTreeQueryKey(tenantId: string) {
  return ["teamhub", tenantId, "document-tree"] as const;
}

export function sharedDocumentTreeQueryKey(tenantId: string) {
  return ["teamhub", tenantId, "shared-document-tree"] as const;
}
