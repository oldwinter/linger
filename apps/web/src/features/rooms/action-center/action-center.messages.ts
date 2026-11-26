import { defineMessages } from "@/i18n/messages";

/** Global Action Center / Live Ops drawer reachable from the primary rail. */
export const actionCenterMessages = defineMessages("actionCenter", {
  title: "Action center",
  subtitle: "Live runs and rooms that need your attention.",
  closeDrawer: "Close action center",
  activeRunsTitle: "Active runs",
  needsAttentionTitle: "Needs attention",
  workingNow: "Working",
  workingFor: "Working · {duration}",
  runFailed: "Run failed",
  unreadMentions: {
    one: "{count} mention",
    other: "{count} mentions",
  },
  openRoom: "Open",
  openRoomAria: "Open {name}",
  noLatestMessage: "No messages yet",
  emptyTitle: "All quiet — no active runs or alerts",
  emptyDescription:
    "Active Agent runs, failed runs, and unread mentions across your workspace will appear here.",
  summaryCounts: "{running} running · {attention} need attention",
});
