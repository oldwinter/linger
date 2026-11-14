export function finishThisPath(tenantId: string, workItemId: string) {
  return `/t/${encodeURIComponent(tenantId)}/dashboard/${encodeURIComponent(workItemId)}/finish`;
}
