import { defineMessages } from "@/i18n/messages";

/** The in-chat live run capsule above the composer for active Agent runs. */
export const liveRunCapsuleMessages = defineMessages("liveRunCapsule", {
  regionLabel: "Active Agent run",
  agentWorking: "{name} is working",
  moreWorking: "+{count} more",
  expandDetails: "Expand live run details",
  collapseDetails: "Collapse live run details",
  stepProgress: "{completed}/{total}",
  noPlanYet: "No step plan published yet.",
  workingFallback: "Working on your request…",
  steerLabel: "Steer or follow up with {name}",
  steerPlaceholder: "Guide {name} with a follow-up…",
  steerAction: "Steer",
  steerSending: "Sending…",
  steerSent: "Follow-up sent to {name}.",
  steerFailed: "Could not send follow-up. Try again.",
  openActivity: "Open activity",
  stopRun: "Stop",
  stoppingRun: "Stopping…",
  stopRunAria: "Stop {name}'s run",
  stopFailed: "The run could not be stopped.",
  activeRuns: "Active runs",
});
