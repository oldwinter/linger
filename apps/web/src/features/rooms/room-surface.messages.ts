import { defineMessages } from "@/i18n/messages";

/**
 * The Room frame that is on screen before the chat module loads: the header,
 * the sidebar toggles, the connection status and the loading surfaces. It
 * shares the `chat` namespace and is declared apart so the chat's own text
 * stays out of the first download.
 */
export const roomSurfaceMessages = defineMessages("chat", {
  roomRegion: "Room {name}",
  roomSettings: "Room settings",
  openSettingsFromAvatar: "Open {name} settings from avatar",
  roomDeleted: "Deleted",
  deleteRoom: "Delete Room",
  sidebar: "Sidebar",
  showSidebar: "Show sidebar",
  hideSidebar: "Hide sidebar",
  loadingPanelSidebar: "Loading panel sidebar",
  loadingSidebar: "Loading sidebar...",
  loggingOut: "Logging out",
  retryLogout: "Retry logout",
  // Connection status in the Room header.
  offline: "Offline",
  syncingRoom: "Syncing Room",
  reconnecting: "Reconnecting",
  roomOutsideScope: "TeamHub returned a Room outside the active scope.",
  roomRefreshFailed: "Room refresh failed.",
  // Loading surfaces.
  loadingConversation: "Loading conversation",
  loadingConversationStatus: "Loading conversation…",
  loadingRoute: "Loading {name}",
  loadingRouteStatus: "Loading {name}...",
  loadingDocumentBody: "Loading Document body",
  routeDocument: "Document",
  routeRoom: "Room",
  routeRooms: "Rooms",
  routeLocalComputers: "Local computers",
  routeApps: "Apps",
  routeDashboard: "Dashboard",
  libraryOverview: "Overview",
  libraryMyPages: "My pages",
  librarySharedWithMe: "Shared with me",
  // The page of a space without Rooms.
  createFirstRoom: "Create the first Room",
  firstRoomBody:
    "Rooms keep Human and Agent members, Messages, and shared files in one collaboration context.",
  createRoom: "Create Room",
  // Room header actions and pinned messages.
  searchThisRoom: "Search this Room",
  addDocumentAction: "Add a document",
  howWorkMoves: "How work moves",
  whoCanManage: "Who can manage",
  steerThisRun: "Steer this run",
  handOff: "Hand off",
  routinesAction: "Routines",
  comeBack: "Come back",
  stepOut: "Step out",
  pinnedMessages: "Pinned messages",
  pinnedMessagesCount: "Pinned messages ({count})",
  pinnedHeading: "Pinned",
  closePinnedMessages: "Close pinned messages",
  searchPinnedMessages: "Search pinned messages",
  clearPinnedSearch: "Clear pinned message search",
  loadingPinnedMessages: "Loading pinned messages",
  retryPinnedMessages: "Retry pinned messages",
  noPinnedMessages: "No pinned messages yet.",
  noPinnedMatch: "No pinned messages match “{query}”.",
  clearSearch: "Clear search",
  pinnedCountOf: "{shown} of {total}",
});
