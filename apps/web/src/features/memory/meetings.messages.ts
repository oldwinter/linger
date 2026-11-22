import { defineMessages } from "@/i18n/messages";

/** The Library Meetings tab and the page of one meeting. */
export const meetingsMessages = defineMessages("meetings", {
  // How a meeting and its start are named everywhere.
  whenFormat: "{day}, {time}",
  meetingNamed: "Meeting {when}",
  meetingHeading: "Meeting · {when}",

  // The Meetings tab: range, calendar and list.
  range: "Meeting range",
  rangeToday: "Today",
  rangeWeek: "Past 7 days",
  rangeAll: "All meetings",
  loading: "Loading meetings…",
  couldNotLoad: "Meetings could not be loaded.",
  calendar: "Meeting calendar",
  dayCount: {
    one: "{date}: {count} meeting",
    other: "{date}: {count} meetings",
  },
  dayCountTip: {
    one: "{date} · {count} meeting",
    other: "{date} · {count} meetings",
  },
  today: "Today",
  dayToday: "{day} · Today",
  search: "Search meetings",
  searchPlaceholder: "Search by date or time",
  noneOnDay: "No meetings on {day}.",
  meetingsOn: "Meetings on {date}",
  summaryOf: "Summary of Meeting {when}",
  summary: "Summary",
  deleteNamed: "Delete {name}",
  deleteMeeting: "Delete meeting",
  noMatch: "No meetings match “{query}”.",
  noneToday: "No meetings today.",
  noneThisWeek: "No meetings in the past 7 days.",
  noneYet: "No meetings yet.",

  // Deleting a meeting from the reader's own Meetings.
  deleteBody:
    "<strong>{name}</strong> will no longer show in your Meetings. Others who can see it keep it.",
  couldNotDelete: "Couldn’t delete the meeting. Try again.",

  // The page of one meeting.
  pageTitle: "Meetings",
  openOwnedByMe: "Open Owned by Me",
  tableOfContents: "Table of contents",
  content: "Meeting content",
  loadingMeeting: "Loading meeting...",
  unavailable: "Meeting is unavailable.",
  retryMeeting: "Retry meeting",
  meeting: "Meeting",
  readOnly: "Read only",
  views: "Meeting views",
  transcript: "Transcript",
  downloadSummary: "Download summary",
  meetingSummary: "Meeting summary",
  summaryDocument: "Meeting summary document",
  summaryPending:
    "The summary is still being written. The transcript is ready now.",
  fileUnavailable: "File unavailable.",
  downloadFailed: "Download failed.",
  downloadFile: "Download {filename}",
  downloadRecording: "Download recording",
  downloadTranscript: "Download transcript",
  loadingRecording: "Loading recording…",
  loadingTranscript: "Loading transcript…",
  previewUnavailable: "Preview unavailable. Download the recording to open it.",
  previewUnavailableListen: "Preview unavailable · download to listen",

  // The summary as the reader presents it.
  overview: "Meeting overview",
  topics: "Topics",
  keywords: "Keywords",
  outcomeDecision: "Decision",
  outcomeCompleted: "Completed",
  outcomeAction: "Action",

  // The recording player.
  recording: "Meeting recording",
  playRecording: "Play recording",
  pauseRecording: "Pause recording",
  cannotPlay: "This browser cannot play it; download instead.",
  seekRecording: "Seek recording",
  playbackPosition: "{current} of {total}",
});
