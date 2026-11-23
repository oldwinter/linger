import { defineMessages } from "@/i18n/messages";

/** Wiki > Timeline: the report cards, the ruler and the report panel. */
export const wikiTimelineMessages = defineMessages("wikiTimeline", {
  // Page.
  dailyReport: "Daily report",
  weeklyReport: "Weekly report",
  reportCount: {
    one: "{count} report · Browse by day",
    other: "{count} reports · Browse by day",
  },
  generating: "Wiki is being generated…",
  unavailable: "Timeline is unavailable.",
  graphUnavailable: "Personal Knowledge Graph is unavailable",
  emptyTimeline:
    "No timeline yet. Add a source or have a conversation to build your Wiki.",
  retryGraph: "Retry graph",
  hiddenPreferences:
    "This graph cannot display your hidden-file preferences. Refresh the graph to load the current view.",
  graphFrame: "Personal knowledge graph",

  // Toolbar.
  granularity: "Timeline granularity",
  day: "Day",
  week: "Week",
  searchPages: "Search pages",
  noReports: "No reports available.",

  // Ruler.
  noDated: "No dated sessions or events yet.",
  jumpToLatest: "Jump to latest",
  latest: "Latest",
  playhead: "Timeline playhead",
  dateWithYear: "{date}, {year}",

  // Report cards.
  dailyTimeline: "Daily timeline",
  weeklyTimeline: "Weekly timeline",
  previousDayCard: "Previous day card",
  previousWeekCard: "Previous week card",
  nextDayCard: "Next day card",
  nextWeekCard: "Next week card",
  retryReports: "Retry reports",
  loadingDailyCards: "Loading Daily cards…",
  loadingWeeklyCards: "Loading Weekly cards…",
  noDailyCards: "No Daily reports or dated pages yet.",
  noWeeklyCards: "No Weekly reports or dated pages yet.",
  dailyCards: "Daily cards",
  weeklyCards: "Weekly cards",

  // Report panel.
  dailySummary: "Daily summary",
  weeklySummary: "Weekly summary",
  toggleDailyContents: "Toggle Daily contents",
  toggleWeeklyContents: "Toggle Weekly contents",
  contents: "Contents",
  closeDaily: "Close Daily",
  closeWeekly: "Close Weekly",
  dailyContents: "Daily contents",
  weeklyContents: "Weekly contents",
  loadingDaily: "Loading Daily…",
  loadingWeekly: "Loading Weekly…",
  retryDaily: "Retry Daily",
  retryWeekly: "Retry Weekly",
  dailyContent: "{day} Daily content",
  weeklyContent: "{day} Weekly content",
  noDailyReport: "No Daily report for this day.",
  noWeeklyReport: "No Weekly report for this week.",
  resizeDailyTop: "Resize Daily top edge",
  resizeDailyBottom: "Resize Daily bottom edge",
  resizeDailyRight: "Resize Daily right edge",
  resizeDailyLeft: "Resize Daily left edge",
  resizeDailyTopRight: "Resize Daily top right corner",
  resizeDailyTopLeft: "Resize Daily top left corner",
  resizeDailyBottomRight: "Resize Daily bottom right corner",
  resizeDailyBottomLeft: "Resize Daily bottom left corner",
  resizeWeeklyTop: "Resize Weekly top edge",
  resizeWeeklyBottom: "Resize Weekly bottom edge",
  resizeWeeklyRight: "Resize Weekly right edge",
  resizeWeeklyLeft: "Resize Weekly left edge",
  resizeWeeklyTopRight: "Resize Weekly top right corner",
  resizeWeeklyTopLeft: "Resize Weekly top left corner",
  resizeWeeklyBottomRight: "Resize Weekly bottom right corner",
  resizeWeeklyBottomLeft: "Resize Weekly bottom left corner",

  // Raised while loading reports.
  reportUnavailable: "Report is unavailable.",
  repeatedCursor: "Report pagination returned a repeated cursor.",
});
