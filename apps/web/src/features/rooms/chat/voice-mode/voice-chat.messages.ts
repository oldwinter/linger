import { defineMessages } from "@/i18n/messages";

/** Voice Mode in the chat: selections added to voice, and the live draft. */
export const voiceChatMessages = defineMessages("voiceChat", {
  addToVoice: "Add to voice",
  addedToVoice: "Added to voice",
  addFile: "Add {filename} to voice",
  fileAdded: "{filename} added to voice",
  messageSelection: "Selected message voice context",
  documentSelection: "Selected document voice context",
  selections: "Selected voice materials",
  removeSelection: "Remove selection from {title}",
  liveDraft: "Live voice draft",

  // Why a selection was not added or sent.
  addFailed: "This selection could not be added. Please try again.",
  onlyMessageText: "Only message text can be added from another Room.",
  selectionTooLong:
    "Select up to {characters} characters from an available document or message.",
  tooManySelections:
    "Use up to {selections} selections and {characters} characters. Remove a selection first.",
  messageTooLong:
    "Your voice message and references exceed {characters} characters. Remove a selection or shorten the draft.",
});
