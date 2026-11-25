import { defineMessages } from "@linger/service-kit/messages";

// The page the window shows instead of the server (offline.html): the server
// is out of reach, the services on this computer start or update, or no
// server is set yet.
export const offlineMessages = defineMessages("offline", {
  unreachableTitle: "Can't reach the server",
  unreachable:
    "LingerX can't reach <host>{host}</host>. Check your network or VPN and make sure the server is running.",
  tryAgain: "Try Again",
  changeServer: "Change Server",
  showLogs: "Show Logs",
  saveDiagnostics: "Save Diagnostics",
  sendDiagnostics: "Send Diagnostics",
  setUpAgain: "Set Up Again",
  serverAddress: "Server address",
  serverHint: "The address of your team's LingerX server.",
  invalidServer: "Enter a server address that starts with http:// or https://",
  connect: "Connect",
  cancel: "Cancel",
  updatingTitle: "Updating LingerX",
  updating:
    "LingerX is restarting on this computer with the new version. This takes about a minute.",
  updatingPhase: "Updating LingerX services…",
  startingTitle: "Starting LingerX",
  starting: "LingerX is starting on this computer. This takes about a minute.",
  startingPhase: "Starting local services…",
  takingLonger: "Taking longer than expected?",
  failedTitle: "LingerX couldn't start on this computer",
  setupTitle: "Connect to LingerX",
  setup: "Enter your team's server address, then sign in.",
  backToSetup: "Back to Setup",
  retrying: "Retrying in {seconds}s",
});
