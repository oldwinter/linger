import { defineMessages } from "@/i18n/messages";

/**
 * The Activity panels of the Room side panel: a Task's activity and details,
 * a Message's activity log, an Agent's live activity, and the dialog that
 * reads a delegated Task like a conversation. Names, titles, priorities and
 * reasons TeamHub sends are data and are shown as they arrive.
 */
export const activityPanelMessages = defineMessages("activityPanel", {
  backToAgentInfo: "Back to Agent info",
  // An Agent's live activity.
  agentActivity: "{name} activity",
  activity: "Activity",
  waitingForActivity: "Waiting for activity",
  activityLoadFailedTitle: "Activity could not be loaded",
  activityLoadFailedDetail:
    "Published Runtime events could not be read from TeamHub.",
  noActivityTitle: "No activity yet",
  noActivityDetail: "This run has not published any activity events yet.",
  // A Message's activity log.
  messageActivities: "{name} activities",
  refreshMessageActivities: "Refresh message activities",
  refresh: "Refresh",
  activitiesLoadFailedTitle: "Activities could not be loaded",
  activitiesLoadFailedDetail: "The Message activity log could not be read.",
  loadingActivities: "Loading activities",
  activityLogUnavailable: "Message activity log unavailable",
  onlyLinkedToolRecords:
    "Only linked tool records are available for this execution.",
  // {limit} is the number of records kept, such as 10,000.
  turnTruncated:
    "This unusually large turn was limited to the latest {limit} records.",
  onlyLinkedRuntimeRecords:
    "Only Runtime records connected by Activity identity are shown.",
  noExactActivityLog: "No exact activity log for this Message",
  // A Task's activity panel.
  taskActivities: "Task activities",
  task: "Task",
  // {number} is the Task's number, such as 17.
  taskNumber: "Task #{number}",
  refreshTask: "Refresh task",
  taskActivity: "Task activity",
  attempt: "Attempt {number}",
  updated: "Updated {time}",
  taskSections: "Task sections",
  tabActivity: "Activity",
  tabDetails: "Details",
  taskLoadFailed: "Task could not be loaded.",
  loadingTask: "Loading task…",
  executionLoadFailed: "Execution status could not be loaded.",
  noActivityAccess: "You do not have access to this task’s work room activity.",
  activityLoadFailedRefresh: "Activity could not be loaded. Try refreshing.",
  loadingActivityEllipsis: "Loading activity…",
  reconnecting: "Reconnecting to live activity…",
  noPublishedActivity:
    "No published activity yet. Earlier runs may not have an activity history.",
  taskMessages: "Task messages",
  messagesLoadFailed: "Messages could not be loaded.",
  noTaskMessages: "No task messages yet.",
  loadEarlierMessages: "Load earlier messages",
  assignees: "Assignees",
  unassigned: "Unassigned",
  priority: "Priority",
  execution: "Execution",
  executionNotEnabled: "Execution is not enabled",
  reason: "Reason",
  description: "Description",
  activityLoadFailed: "Activity could not be loaded.",
  // The state of a Task's execution.
  stageWaitingForApproval: "Waiting for approval",
  stageIdle: "Idle",
  // The state of one Agent's run inside a Task.
  runWorking: "Working",
  runPaused: "Paused",
  runInterrupted: "Interrupted",
  runEnded: "Ended",
  // {time} is when the run started; {state} is one of the states above.
  runStarted: "{time} · {state}",
  agentWorking: "Agent working",
  // The dialog that reads a delegated Task like a conversation.
  taskConversation: "Task conversation",
});
