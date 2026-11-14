export function dashboardWorkItemPath(tenantId: string, workItemId: string) {
  return `/t/${encodeURIComponent(tenantId)}/dashboard/${encodeURIComponent(workItemId)}`;
}

/** The Item's dashboard link as text pasted outside this app needs it. */
export function dashboardWorkItemUrl(tenantId: string, workItemId: string) {
  return `${window.location.origin}${dashboardWorkItemPath(tenantId, workItemId)}`;
}
