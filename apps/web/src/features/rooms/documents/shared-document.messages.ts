import { defineMessages } from "@/i18n/messages";

/** The page a document link opens, with or without a signed-in reader. */
export const sharedDocumentMessages = defineMessages("sharedDocument", {
  title: "Shared file",
  refresh: "Refresh file",
  unavailableWithChanges:
    "The link is unavailable. Your unsaved changes are still here.",
  unavailable: "This link is unavailable or has been revoked.",
  loading: "Loading file…",
  saveFailed: "Unable to save this version.",
  canEdit: "Can edit",
  readOnly: "Read only",
  download: "Download",
  signInToEdit: "Sign in to edit",
  saving: "Saving...",
  uploadVersion: "Upload version",
  fileContent: "File content",
});
