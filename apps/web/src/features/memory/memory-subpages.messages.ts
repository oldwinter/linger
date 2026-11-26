import { defineMessages } from "@/i18n/messages";

/**
 * Lazy messages for the Memory timeline hub (Day, Day shape, Week) and
 * meeting companion subpages (Up next, Carry decision, Story, Reminders, Ask, Keep).
 */
export const memorySubpagesMessages = defineMessages("memorySubpages", {
  // Memory timeline hub tabs.
  timelineViews: "Memory timeline views",
  tabDay: "Day",
  tabDayShape: "Day shape",
  tabWeek: "Week",

  // Shared navigation & status labels.
  backToLibrary: "Back to Library",
  backToMeetings: "Back to meetings",
  backToMeeting: "Back to the meeting",
  backToNamed: "Back to {name}",
  daysNav: "Days",
  previousDay: "Previous day",
  nextDay: "Next day",
  today: "Today",
  thisDay: "This day",
  shapeOfToday: "Shape of today",
  shapeOfThisDay: "Shape of this day",
  meetingNamed: "Meeting {when}",
  meetingHeading: "Meeting · {when}",
  meetingFallback: "Meeting",
  thisMeetingFallback: "this meeting",
  loadingMeeting: "Loading the meeting.",
  loadingThisMeeting: "Loading this meeting...",
  meetingLoadFailed: "Could not load this meeting.",
  meetingCouldNotOpen: "This meeting could not be opened.",
  meetingNotInLibrary: "This meeting is not in your library.",
  meetingsLoadFailed: "Meetings could not be loaded.",

  // Day review page (Memory Timeline Hub).
  pocket: "Pocket",
  pocketEditable: "Editable today",
  pocketReadOnly: "Read only",
  loadingPocket: "Loading Pocket…",
  pocketLoadFailed: "Pocket could not be loaded.",
  nothingInPocket: "Nothing was kept in Pocket.",
  todayPocketLabel: "Today's Pocket Note",
  saveToPocket: "Save to Pocket",
  pocketSaved: "Saved. Another Me reads this into memory.",
  pocketNotSaved: "Pocket was not saved.",
  meetings: "Meetings",
  loadingMeetings: "Loading meetings…",
  noMeetings: "No meetings.",
  dailyReport: "Daily report",
  reportReady: "Ready",
  reportPending: "Not written",
  loadingReport: "Loading the report…",
  reportLoadFailed: "The report could not be loaded.",
  reportWrittenFallback: "Another Me wrote this day.",
  openOnTimeline: "Open on the timeline",
  reportNotWritten: "Another Me has not written this day.",

  // Day shape page.
  dayShapeTitle: "Shape of {day}",
  dayShapeTitleToday: "Shape of {day} · Today",
  dayShapeSubtitle:
    "Open stretches and the meetings that sit in them. The hours run from 08:00 through 19:00, and widen when a meeting falls outside.",
  loadingDay: "Loading the day.",

  // Week memory page.
  whatChangedThisWeek: "What changed this week",
  weekMemoryTitle: "The week in memory",
  weekMemorySubtitle:
    "{from} through {to}. Meetings, dailies, and notes from the whole week.",
  loadingWeek: "Loading the week.",
  weekLoadFailed: "The week could not be loaded.",
  daysWithMemory: "Days with memory",

  // Up next page.
  upNextTitle: "Up next",
  upNextSubtitle: "The meeting that is closest, counted down while you watch.",
  checkingClock: "Checking the clock.",
  clockLoadFailed: "The clock could not be read.",
  openThisMeeting: "Open this meeting",

  // Carry a decision page.
  carryTitle: "Carry a decision",
  carrySubtitle:
    "Send one decision from {meeting} into a room. The meeting stays as it is.",
  sentToRoom: "Sent to {room}. That room now has the decision.",
  noDecisionToCarry: "This meeting has no decision to carry.",
  noRoomToReceive: "There is no room to receive it.",
  whichDecision: "Which decision",
  whichRoom: "Which room",
  roomDidNotReceive: "The room did not receive it.",
  sending: "Sending",
  sendItThere: "Send it there",
  openRoom: "Open {room}",

  // Tell this story page.
  tellStoryTitle: "Tell this story",
  tellStorySubtitle:
    "{meeting}. The lines you could say out loud, then the one you would actually tell.",
  noStoryYet: "This meeting does not have a story to tell yet.",
  partYouWouldTell: "The part you would tell",
  meetingStoryLabel: "Meeting story",
  thisIsPartIWouldTell: "This is the part I would tell",

  // Turn to-dos into reminders page.
  remindersTitle: "Turn to-dos into reminders",
  remindersSubtitle:
    "Each to-do becomes a reminder in your chat with Another Me. The meeting stays as it is.",
  chooseTimeError: "Choose a time for each to-do.",
  createReminderFailed: "Could not create the reminder.",
  noTodosToRemind: "This meeting has no to-dos to remind you about.",
  skipped: "Skipped.",
  reminderSetFor: "Reminder set for {when}.",
  remindMe: "Remind me",
  skipTodo: "Skip {todo}",
  skip: "Skip",
  anotherMeNotSetUp:
    "Another Me is not set up, so these to-dos cannot become reminders yet.",
  anotherMeWillRemind: {
    one: "Another Me will remind you.",
    other: "Another Me will remind you about {count} to-dos.",
  },
  creatingReminders: "Creating reminders",
  createReminders: "Create reminders",

  // Ask the recording page.
  askTitle: "Ask the recording",
  askSubtitle:
    "Ask something the recording can answer. The answer stays with this meeting.",
  loadingQuestions: "Loading saved questions...",
  questionsLoadFailed: "Could not load saved questions.",
  nothingAskedYet: "Nothing has been asked of this recording yet.",
  whatDoYouWantToKnow: "What do you want to know?",
  questionFailed: "That question did not go through.",
  taskRequestNotSent:
    "This page keeps answers from the recording. That question was a request for Another Me, and it was not sent.",

  // Keep this meeting page.
  keepTitle: "Keep this meeting",
  keepSubtitle:
    "These words become a page in your library. The meeting stays as it is, and you can keep writing the page.",
  pageName: "Page name",
  keepThisPage: "Keep this page",
  pageCouldNotBeKept: "The page could not be kept.",
  summaryNotWrittenYet:
    "The summary is not written yet, so there is nothing to keep as a page.",
});
