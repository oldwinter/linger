import { defineMessages } from "@/i18n/messages";

/**
 * The few strings of the app shell that loads first: the sign-in loader, the
 * content boundary inside a Room or the Library, and a nameless avatar. Keep
 * this namespace small; it ships in the first-load bundle.
 */
export const shellExtrasMessages = defineMessages("shellExtras", {
  // The signed-in Account belongs to no Space, so no page can open.
  noSpace: "This Account has no Space.",
  loadingContent: "Loading content",
  loadingContentStatus: "Loading content...",
  // An avatar whose Actor has no display name.
  unknownActor: "Unknown Actor",
});
