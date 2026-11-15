const stateLabel: Record<string, string> = {
  in_progress: "In progress",
  open: "Todo",
  resolved: "Resolved",
};

/** One line of a Work Item's story. Display only. */
export function workItemActivityText(activity: {
  actor: { display_name: string };
  from_state?: string;
  kind: string;
  to_state?: string;
}): string {
  const name = activity.actor.display_name;
  switch (activity.kind) {
    case "created":
      return `${name} opened this Work Item.`;
    case "state_transitioned":
      return `${name} moved it from ${stateLabel[activity.from_state ?? ""] ?? "another state"} to ${stateLabel[activity.to_state ?? ""] ?? "another state"}.`;
    case "work_room_created":
      return `${name} opened a Room for this work.`;
    case "mandate_recorded":
      return `${name} recorded the rule that created this Work Item.`;
    case "assignment_added":
      return `${name} added an assignee.`;
    case "assignment_removed":
      return `${name} removed an assignee.`;
    case "archived":
      return `${name} archived this Work Item.`;
    case "unarchived":
      return `${name} restored this Work Item.`;
    case "comment_edited":
      return `${name} edited a comment.`;
    case "comment_deleted":
      return `${name} removed a comment.`;
    default:
      return `${name} updated this Work Item.`;
  }
}

export function workItemStoryPath(tenantId: string, workItemId: string) {
  return `/t/${encodeURIComponent(tenantId)}/work-items/${encodeURIComponent(workItemId)}`;
}

export function workRoomPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;
}
