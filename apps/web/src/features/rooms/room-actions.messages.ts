import { defineMessages } from "@/i18n/messages";

/** Room action subpages: Catch up, Who is awake, Surprise me, Hand off, Step out, Add document, Who manages, How work moves. */
export const roomActionsMessages = defineMessages("roomActions", {
  // Shared navigation & states
  backToChats: "Back to chats",
  backToRooms: "Back to rooms",
  backToRoom: "Back to room",
  backToTheRoom: "Back to the room",
  backToNamedRoom: "Back to {name}",
  loadingRoom: "Loading this room...",
  openingRoom: "Opening the room.",
  roomOpenFailed: "This room could not be opened.",
  previous: "Previous",
  next: "Next",
  finish: "Finish",

  // Catch up
  catchUpTitle: "Catch up",
  catchUpLoadFailed: "Chats could not be loaded.",
  catchUpLoading: "Loading chats…",
  catchUpProgress: "{current} of {total}",
  catchUpNewMessages: {
    one: "{count} new message",
    other: "{count} new messages",
  },
  catchUpMentions: {
    one: "{count} mention",
    other: "{count} mentions",
  },
  catchUpMessagesWhenStarted: {
    one: "{count} new message when you started",
    other: "{count} new messages when you started",
  },
  catchUpMentionsWhenStarted: {
    one: "{count} mention when you started",
    other: "{count} mentions when you started",
  },
  catchUpMessagesAndMentionsWhenStarted:
    "{messages} and {mentions} when you started",
  catchUpNoteHeading: "Caught up",
  catchUpDoneTitle: "You're caught up",
  catchUpNothingNew: "No chats have new messages.",
  catchUpWalkedChats: {
    one: "You walked {count} chat.",
    other: "You walked {count} chats.",
  },
  catchUpKeepInNote: "Keep this in today's note",
  catchUpStartOver: "Start over",
  catchUpKeptInNote: "Kept in today's note.",
  catchUpSaveFailed: "Today's note was not saved.",

  // Who is awake
  whoIsAwakeTitle: "Who is awake",
  whoIsAwakeDescription: "Agents you can reach, updating as they come and go.",
  whoIsAwakeLoading: "Checking who is awake.",
  whoIsAwakeLoadFailed: "Who is awake could not be loaded.",
  whoIsAwakeStatusUnavailable: "Status unavailable",
  whoIsAwakeNone: "Everyone is quiet.",
  whoIsAwakeCount: {
    one: "{count} is awake.",
    other: "{count} are awake.",
  },
  whoIsAwakeAgentsList: "Agents",
  whoIsAwakeTalkTo: "Talk to {name}",

  // Surprise me
  surpriseTitle: "Surprise me",
  surpriseDescription: "Spin the rooms you belong to, then go where it lands.",
  surpriseLoading: "Gathering rooms.",
  surpriseLoadFailed: "The rooms could not be gathered.",
  surpriseEmpty: "There is no room to land in.",
  surpriseReady: "Ready when you are.",
  surpriseLanded: "It landed on {title}.",
  surpriseGoTo: "Go to {title}",
  surpriseSpinAgain: "Spin again",
  surpriseSpinning: "Spinning",
  surpriseSpin: "Spin",

  // Hand this off
  handOffTitle: "Hand this off",
  handOffThreadNotice:
    "A thread stays with its room. Hand work off from the room itself.",
  handOffDescription:
    "Name the job. The person you choose keeps it, and it shows up on the dashboard.",
  handOffFallbackAssignee: "They",
  handOffDone: "{name} has it. It waits on the dashboard.",
  handOffSeeDashboard: "See it on the dashboard",
  handOffJobLabel: "What needs doing",
  handOffNoCandidates: "There is no one else here to hand work to.",
  handOffToPerson: "Hand it to {name}",
  handOffFailed: "That handoff did not go through.",

  // Step out
  stepOutTitle: "Step out",
  stepOutSubtitleWithRoom: "{name} keeps your place and its history.",
  stepOutSubtitleFallback: "A room can go quiet without losing your place.",
  stepOutRegularOnly:
    "This conversation stays with you. Only a regular room can go quiet.",
  stepOutLeftStatus:
    "You stepped out. New messages will not arrive, and you cannot send, until you come back.",
  stepOutComingBack: "Coming back",
  stepOutComeBack: "Come back",
  stepOutJoinedNotice:
    "Step out and this room goes quiet. You keep your place and the history. New messages will not arrive, and you cannot send, until you come back.",
  stepOutPending: "Stepping out",
  stepOutFailed: "The room did not change.",

  // Add a document
  addDocumentTitle: "Add a document",
  addDocumentDescription:
    "Choose documents to keep in this room. They stay yours, and the room can read them.",
  addDocumentLoading: "Loading documents.",
  addDocumentLoadFailed: "Documents could not be loaded.",
  addDocumentFilterLabel: "Filter documents",
  addDocumentSearchPlaceholder: "Search documents...",
  addDocumentNoMatches: "No matching documents.",
  addDocumentNoneLeft: "No documents left to add.",
  addDocumentAlreadyInRoom: "Already in this room",
  addDocumentBindFailed: "The document could not be added.",
  addDocumentAddedCount: {
    one: "Added {count} document to this room.",
    other: "Added {count} documents to this room.",
  },
  addDocumentAdding: "Adding",
  addDocumentSubmit: "Add to this room",

  // Who can manage
  whoManagesTitle: "Who can manage this room",
  whoManagesDescription:
    "Someone who can manage may change the room and who belongs to it. Someone who takes part can work in it. The room keeps this choice.",
  whoManagesLoading: "Loading who can manage.",
  whoManagesLoadFailed: "Who can manage could not be loaded.",
  whoManagesOwnerOnly: "Only someone who can manage this room can change this.",
  whoManagesAgentRow: "{name} takes part. Agents do not manage the room.",
  whoManagesRoleOwner: "Can manage",
  whoManagesRoleMember: "Takes part",
  whoManagesNeedOwner: "The room needs someone who can manage it.",
  whoManagesSaveFailed: "The room could not be updated.",
  whoManagesSaved: "Saved. This room will keep that.",
  whoManagesSaving: "Saving",

  // How work moves
  workMovesTitle: "How work moves",
  workMovesDescription:
    "The path an agent published for this room. A newer team.md replaces it here.",
  workMovesLoading: "Loading how work moves.",
  workMovesLoadFailed: "How work moves could not be loaded.",
  workMovesEmpty:
    "No collaboration plan yet. When an agent publishes one, the path shows up here.",
  workMovesPathLabel: "Work path",
  workMovesPatternClassify:
    "Work is sorted first, then the person who owns that kind of work does it.",
  workMovesPatternFanOut:
    "The same question goes out to several people, and one person gathers what comes back.",
  workMovesPatternAdversarial:
    "One person prepares the work. Another checks it and sends the findings back.",
  workMovesPatternTournament:
    "Several people try the same task, and the strongest result is the one that remains.",
  workMovesPatternLoop:
    "The work goes around again until the goal is actually met.",
  workMovesStepStart: "{who} starts the work.",
  workMovesStepHandoff: "{who} hands the work to {other}.",
  workMovesStepReport: "{who} reports back to {other}.",
});
