/** The read-only page of one meeting, named by its `entry` query. */
export function meetingPath(tenantId: string, meetingId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/meetings?entry=${encodeURIComponent(meetingId)}`;
}
