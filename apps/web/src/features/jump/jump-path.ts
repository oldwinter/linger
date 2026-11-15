export function jumpPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/jump`;
}
