export function hearingPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/hearing`;
}
