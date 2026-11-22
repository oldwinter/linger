import { defineMessages } from "@/i18n/messages";

/** What the shared-link page says when the shared file cannot be read yet. */
export const teamHubExtrasMessages = defineMessages("teamHubExtras", {
  sharedFilePreparing: "File content is being prepared. Retry shortly.",
  sharedFileIntegrityFailed: "The shared file failed integrity verification.",
});
