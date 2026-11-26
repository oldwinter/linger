import { defineMessages } from "@linger/service-kit/messages";

// The Quick Note capture window (quick-note.html and quick-note.ts).
export const quickNoteMessages = defineMessages("quickNote", {
  pageTitle: "New Note",
  label: "Add to today's Pocket Note",
  placeholder: "What's on your mind?",
  shortcutHint: "Cmd/Ctrl+Enter to save · Esc to cancel",
  save: "Save",
  saving: "Saving…",
  saved: "Saved to today's Pocket Note.",
  empty: "Write something first.",
  tooLong: "This note is too long.",
  tooLongForToday: "This note is too long for today's page.",
  notConnected: "Connect this computer in LingerX first.",
  notSignedIn: "Sign in to LingerX first.",
  sessionEnded:
    "Your LingerX session ended. Sign in again, then try once more.",
  readFailed: "Couldn't read today's note. Try again.",
  saveFailed: "Couldn't save the note. Try again.",
});
