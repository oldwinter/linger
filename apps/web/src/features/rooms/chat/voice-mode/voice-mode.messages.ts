import { defineMessages } from "@/i18n/messages";

/** Voice Mode in the composer. */
export const voiceModeMessages = defineMessages("voiceMode", {
  // The composer button before Voice Mode starts.
  start: "Start Voice Mode",
  finishing: "Finishing Voice Mode",
  finishingHint: "Finishing last words and releasing the microphone",
  onInRoom: "Voice Mode is on in {room}",
  onInAnotherRoom: "Voice Mode is on in another Room",
  liveHint: "Voice Mode: a live conversation with Grok",
  dictationHint: "Voice Mode: sends when you finish speaking",
  keyHint: "Voice Mode: add a Soniox or xAI key to start",
  unableToStart: "Unable to start Voice Mode",

  // The bar that replaces the composer toolbar while Voice Mode is on.
  controls: "Voice Mode controls",
  voiceInput: "Voice input",
  retry: "Retry voice message",
  retryHint: "Retry the same voice message",
  mute: "Mute microphone",
  unmute: "Unmute microphone",
  replySoundOn: "Turn reply sound on",
  replySoundOff: "Turn reply sound off",
  exit: "Exit Voice Mode",

  // What Voice Mode is doing, read to screen readers.
  statusClosing: "Microphone off · Finishing last words…",
  statusConnectingTranscription: "Connecting transcription…",
  statusConnectingMicrophone: "Connecting microphone…",
  statusStopped: "Voice input stopped · Exit to review your draft",
  statusPaused: "Microphone off · Draft kept",
  statusFlushing: "Finishing this message… You can keep speaking",
  statusSending: "Sending message… You can keep speaking",
  statusListening: "Listening · Sends when you finish speaking",
});
