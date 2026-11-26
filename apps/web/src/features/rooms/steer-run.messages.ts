import { defineMessages } from "@/i18n/messages";

/** The Steer this run view: live plan steps and stopping a working Run. */
export const steerRunMessages = defineMessages("steerRun", {
  backToRoom: "Back to room",
  title: "Steer this run",
  description:
    "The plan the agent published while it is still working. Stop it before the next step.",
  loadingRun: "Loading this run.",
  loadRunFailed: "Run status could not be loaded.",
  retry: "Retry",
  nothingRunning: "Nothing is running in this room.",
  activeRuns: "Active runs",
  agentWorking: "{name} is working",
  loadingPlan: "Loading the plan.",
  loadPlanFailed: "The plan could not be loaded.",
  noPlanYet: "The agent has not published a plan yet.",
  runPlan: "Run plan",
  stopping: "Stopping",
  stopBeforeNextStep: "Stop before the next step",
  stopFailed: "The run could not be stopped.",
  stepCanceled: "Canceled",
  stepCompleted: "Done",
  stepInProgress: "Doing this now",
  stepPending: "Still ahead",
  alreadyFinished: "This run had already finished.",
  stopRequested: "Stop requested. The agent will not take the next step.",
});
