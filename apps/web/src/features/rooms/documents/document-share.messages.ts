import { defineMessages } from "@/i18n/messages";

/**
 * The Document share dialog and its link sharing section. Agent, person and
 * Room names TeamHub sends are data and are shown as they arrive.
 */
export const documentShareMessages = defineMessages("documentShare", {
  shareDocument: "Share Document",
  backToShare: "Back to share",
  share: "Share",
  manageCollaborators: "Manage collaborators",
  // {role} is the access role, such as Viewer or Editor.
  yourAccess: "Your access: {role}",
  settingsUnavailable: "Sharing settings are unavailable.",
  refresh: "Refresh",
  changeStatus: "Share change status",
  savingAccess: "Saving access...",
  inviteCollaborators: "Invite collaborators",
  manageActiveCollaborators: "Manage {count} active collaborators",
  activeCount: "{count} active",
  agentsWithDirectAccess: "Agents with direct access",
  agent: "Agent",
  person: "Person",
  // {label} is the name of an Agent with access.
  permission: "{label} permission",
  removeAccess: "Remove access",
  noDirectCollaborators: "No direct collaborators yet.",
  removeTitle: "Remove {label}?",
  removeAccessBody:
    "Their direct access will be removed. Access from a Room, Task, or Wiki is not affected.",
  sharedWithRooms: "Shared with Rooms",
  removeFromRoom: "Remove from Room",
  // {label} is the name of a Room.
  removeFromRoomTitle: "Remove from {label}?",
  removeFromRoomBody:
    "Room members will lose this source. Direct, Task, and Wiki access are not affected.",
  documentLink: "Document link",
  copyLinkHint:
    "Copying the link does not change who can access this document.",
  searchCollaborators: "Search collaborators",
  searchAgents: "Search Agents",
  addCollaborators: "Add collaborators",
  loadingCollaborators: "Loading collaborators...",
  unableToLoad: "Unable to load. Retry",
  noMatchingCollaborators: "No matching collaborators.",
  selected: "Selected",
  select: "Select",
  inviteRole: "Invite role",
  invite: "Invite",
  inviteCount: "Invite ({count})",
  shareLoading: "Share loading",
  loadingAccess: "Loading access",
  linkCopyFailed: "The Document link could not be copied.",
  inviteFailed:
    "Some collaborators could not be invited. Refresh and try again.",
  removeFromRoomFailed:
    "The Document could not be removed from this Room. Refresh and try again.",
  permissionUpdateFailed: "The collaborator permission could not be updated.",
  removeCollaboratorFailed: "The collaborator could not be removed.",

  linkUpdateFailed: "Link sharing could not be updated.",
  anyoneWithLink: "Anyone with the link",
  linkAccess: "Link access",
  linkDisabled: "Disabled",
  canView: "Can view",
  canEdit: "Can edit",
  resetLink: "Reset link",
  copySharedLink: "Copy shared link",
  sharedLinkCopyFailed: "Could not copy the link.",
  linkSharingUnavailable: "Link sharing is unavailable.",
});
