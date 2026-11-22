import { defineMessages } from "@/i18n/messages";

/**
 * The Work Item Dashboard. Titles, people, Room names and priorities come
 * from TeamHub and are shown as they arrive; a server error message is shown
 * as TeamHub wrote it.
 */
export const workItemsMessages = defineMessages("workItems", {
  dashboard: "Dashboard",
  itemCount: { one: "{count} item", other: "{count} items" },
  // {shown} of {count} Work Items match the Room filter.
  filteredCount: "{shown} of {count} items",
  filters: "Work Item filters",
  noWorkItems: "No Work Items yet",
  // The columns of the board.
  columnTodo: "Todo",
  columnInProgress: "In progress",
  columnDone: "Done",
  columnClosed: "Closed",
  collapseClosed: "Collapse closed",
  expandClosed: "Expand closed",
  // {names} lists the people and Agents a Work Item is assigned to.
  assignedTo: "Assigned to {names}",
  // The kind and number of a Work Item, such as "Task #17".
  issueNumber: "Issue #{number}",
  taskNumber: "Task #{number}",
  // The Room filter.
  room: "Room",
  allRooms: "All rooms",
  noSourceRoom: "No source room",
  // {id} is the id of a Room the Human cannot see.
  unknownRoom: "Unknown room ({id})",
  // The page when the Work Items cannot be loaded.
  dashboardError: "Dashboard error",
  accessDenied: "Access denied",
  dashboardUnavailable: "Dashboard unavailable",
  loadFailed: "TeamHub could not load Work Items.",
  tryingAgain: "Trying again…",
  workItemUnavailable: "Work Item is unavailable in this Tenant.",
  dashboardTenantMismatch:
    "Work Item Dashboard does not match the active Tenant.",
  agentListTenantMismatch:
    "Agent Work Item list does not match the active Tenant.",
});
