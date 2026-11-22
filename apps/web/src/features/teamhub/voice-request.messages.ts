import { defineMessages } from "@/i18n/messages";

/** Why a voice control request to TeamHub failed, as shown to the person. */
export const voiceRequestMessages = defineMessages("voiceRequest", {
  timedOut: "Voice request timed out",
  unreadable: "Voice response could not be read",
});
