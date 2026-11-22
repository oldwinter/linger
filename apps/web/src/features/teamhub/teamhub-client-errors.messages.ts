import { defineMessages } from "@/i18n/messages";

/**
 * Errors the client raises itself about a TeamHub response, such as a
 * Document outside the requested scope or a page cursor that repeats. They
 * carry a client code and are worded where they are raised.
 */
export const teamHubClientErrorMessages = defineMessages(
  "teamHubClientErrors",
  {
    resourceUnavailable: "The requested TeamHub resource is unavailable.",
    roomHistoryTooLong:
      "TeamHub returned more Room history than this client can load.",
    invalidRoomMessageCursor:
      "TeamHub returned an invalid Room Message cursor.",
    invalidCursor: "TeamHub returned an invalid pagination cursor.",
    directoryTooLong:
      "TeamHub returned more directory data than this client can load.",
  },
);
