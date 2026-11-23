import { defineMessages } from "@/i18n/messages";

/** Why a Voice Mode session stopped or could not start, as shown to the person. */
export const voiceSessionMessages = defineMessages("voiceSession", {
  // The session as a whole.
  sessionLimit: "Voice Mode reached its session limit. Exit and start again.",
  inputAhead:
    "Voice input is ahead of message delivery. Your draft is kept; retry or exit to review it.",
  couldNotContinue: "Voice Mode could not continue. Your text has been kept.",
  microphoneOtherTab: "The microphone is active in another tab.",
  authorizationChanged: "Voice Mode authorization changed.",

  // Dictation.
  transcriptionUnavailable: "Voice transcription is unavailable.",
  dictationNotConfirmed:
    "The server did not confirm a chat-only voice session.",
  connectionLost: "Voice connection was lost. Your unsent text is kept.",
  runtimeStopped:
    "Voice Runtime stopped before readiness. Check the configured ASR provider and try again.",
  runtimeKeyRejected:
    "Soniox rejected the API key. Replace it in Settings › API keys, then try again.",
  runtimeKeyNotPermitted:
    "This Soniox API key cannot use real-time transcription. Replace it in Settings › API keys with one that can, then try again.",
  runtimeBalanceExhausted:
    "Your Soniox balance or usage limit is used up. Add credits in the Soniox Console, then try again.",
  runtimeUnreachable:
    "Cannot reach the voice service. Check your network or proxy, then try again.",
  recognitionDisconnected:
    "Voice recognition disconnected. Your unsent text is kept.",
  microphoneDisconnectedKept:
    "Microphone disconnected. Your unsent text is kept.",
  accessLost: "Voice access was lost. Your unsent text is kept.",
  runtimeUnavailable:
    "Voice Runtime is unavailable ({code}). Check the ASR provider and try again.",
  runtimeNotReady:
    "Voice Runtime did not become ready within {seconds} seconds. Check that the Voice Runtime and ASR provider are running, then try again.",
  finalTextMissing:
    "Final voice text did not arrive. Your draft is kept; try again.",
  shutdownUnconfirmed:
    "Voice shutdown could not confirm the last words. Your draft is kept.",
  identityChanged:
    "Voice input identity changed during shutdown. Your draft is kept.",

  // Live voice.
  liveStopped: "Live voice stopped ({code}).",
  liveNotConfirmed: "The server did not confirm a live voice session.",
  liveConnectionLost: "Live voice connection was lost.",
  liveRuntimeDisconnected: "Live voice runtime disconnected.",
  microphoneDisconnected: "Microphone disconnected.",
  liveUnavailable: "Live voice is unavailable ({code}).",
  liveNotReady: "Live voice did not become ready within {seconds} seconds.",
  continuingAsDictation: "Live voice stopped; continuing as dictation.",
  continuingAsDictationWithReason:
    "Live voice stopped; continuing as dictation. {reason}",
});
