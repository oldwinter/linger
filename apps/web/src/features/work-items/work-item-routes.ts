/** The Work Items board of one Tenant, without a view's filters. */
export function dashboardPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/dashboard`;
}

export function dashboardWorkItemPath(tenantId: string, workItemId: string) {
  return `${dashboardPath(tenantId)}/${encodeURIComponent(workItemId)}`;
}

/** The Item's dashboard link as text pasted outside this app needs it. */
export function dashboardWorkItemUrl(tenantId: string, workItemId: string) {
  return `${window.location.origin}${dashboardWorkItemPath(tenantId, workItemId)}`;
}
