import { defineMessages } from "@/i18n/messages";

/**
 * The Files tab of the Room side panel: the list of the Room's Documents, and
 * the states around a file tab before its preview or editor takes over.
 */
export const roomDocumentsMessages = defineMessages("roomDocuments", {
  title: "Files",
  noDocumentsYet: "This Room has no documents yet",
  fileCount: { one: "{count} file", other: "{count} files" },
  roomFiles: "Room files",
  openFile: "Open {name}",
  downloadFile: "Download {name}",
  downloadFailed: "The file could not be downloaded.",
  copyLink: "Copy link",
  copyLinkFailed: "The file link could not be copied.",
  actionsFor: "Actions for {name}",
  emptyTitle: "No Room Documents yet",
  emptyBody: "Documents shared in this Room will show up here.",
  openingDocument: "Opening document...",
  unavailableTitle: "This file is no longer available",
  unavailableBody: "The file was removed or you no longer have access.",
  loadFailedTitle: "File could not be loaded",
  loadFailedBody: "Please retry loading this file.",
});
