import { defineMessages } from "@/i18n/messages";

/**
 * An Agent's status, worded from the `reason` code TeamHub sends beside its
 * English `label` and summary.
 */
export const agentAvailabilityMessages = defineMessages("agentAvailability", {
  offline: "Offline",
  needsAttention: "Needs attention",
  statusUnavailable: "Status unavailable",
  reconnecting: "Reconnecting",
  authenticationRequired: "Authentication required",
  waitingForComputer: "Waiting for the computer to connect",
  runtimeNotInstalled: "The AI app is not installed",
  runtimeIncompatible: "The AI app needs an update",
});
