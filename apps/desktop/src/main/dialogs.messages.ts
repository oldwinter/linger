import { defineMessages } from "@linger/service-kit/messages";

// The main process's native dialogs, windows and notifications.
export const dialogMessages = defineMessages("dialogs", {
  quitConfirm: "Quit Linger and stop the running tasks?",
  quitConfirmDetail:
    "Until you open Linger again, tasks from your phone or the web can't run on this computer.",
  quitAndStop: "Quit and Stop Tasks",
  cancel: "Cancel",
  startFailed: "Linger failed to start: {error}",
  setupTitle: "Set Up Linger",
  chooseInstallFolder: "Choose Where to Install Linger",
  choose: "Choose",
  notificationsOnTitle: "Notifications are on",
  notificationsOn: "Linger will tell you here when a task needs you.",
  sendConsent: "Send diagnostics to {host}?",
  sendConsentFiles: {
    one: "{count} file, {size}: logs and settings of this app and of Linger on this computer.",
    other:
      "{count} files, {size}: logs and settings of this app and of Linger on this computer.",
  },
  sendConsentRedacted:
    "Passwords, tokens, keys and your home folder path are removed first; credential files and your data are never included.",
  sendConsentReaders: "Only the people who run {host} can read the report.",
  sendConsentMore: "and {count} more",
  send: "Send",
  sent: "Diagnostics sent",
  sentDetail:
    "Report ID: {reportId}\nGive this ID to Linger support so they can find your report.",
  copyReportId: "Copy Report ID",
  done: "Done",
  sendFailed: "Couldn't send diagnostics",
  sendFailedSave:
    "You can still use Save Diagnostics and send the file by hand.",
  tryAgain: "Try Again",
  close: "Close",
  sendBusy: "Diagnostics are already being sent",
  sendBusyDetail: "Finish or cancel that report in the Linger setup window.",
  ok: "OK",
});
