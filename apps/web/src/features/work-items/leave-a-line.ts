export function leaveALinePath(tenantId: string, workItemId: string) {
  return `/t/${encodeURIComponent(tenantId)}/dashboard/${encodeURIComponent(workItemId)}/line`;
}

export function workItemCommentsKey(workItemId: string) {
  return ["teamhub", "work-item-comments", workItemId] as const;
}
