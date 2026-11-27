import { defineMessages } from "@linger/service-kit/messages";

// The main process's native dialogs, windows and notifications.
export const dialogMessages = defineMessages("dialogs", {
  quitConfirm: "Quit LingerX and stop running tasks?",
  quitConfirmDetail:
    "Quitting closes LingerX, stops in-flight tasks on this computer, and unloads local models. Local background services stay running for web and mobile clients, and stopped tasks will not automatically resume when you reopen LingerX.",
  quitAndStop: "Quit and Stop Tasks",
  keepRunning: "Keep Running",
  cancel: "Cancel",
  startFailed: "LingerX failed to start: {error}",
  setupTitle: "Set Up LingerX",
  chooseInstallFolder: "Choose Where to Install LingerX",
  choose: "Choose",
  notificationsOnTitle: "Notifications are on",
  notificationsOn: "LingerX will tell you here when a task needs you.",
  sendConsent: "Send diagnostics to {host}?",
  sendConsentFiles: {
    one: "{count} file, {size}: logs and settings of this app and of LingerX on this computer.",
    other:
      "{count} files, {size}: logs and settings of this app and of LingerX on this computer.",
  },
  sendConsentRedacted:
    "Passwords, tokens, keys and your home folder path are removed first; credential files and your data are never included.",
  sendConsentReaders: "Only the people who run {host} can read the report.",
  sendConsentMore: "and {count} more",
  send: "Send",
  sent: "Diagnostics sent",
  sentDetail:
    "Report ID: {reportId}\nGive this ID to LingerX support so they can find your report.",
  copyReportId: "Copy Report ID",
  done: "Done",
  sendFailed: "Couldn't send diagnostics",
  sendFailedSave:
    "You can still use Save Diagnostics and send the file by hand.",
  tryAgain: "Try Again",
  close: "Close",
  sendBusy: "Diagnostics are already being sent",
  sendBusyDetail: "Finish or cancel that report in the LingerX setup window.",
  ok: "OK",
});
