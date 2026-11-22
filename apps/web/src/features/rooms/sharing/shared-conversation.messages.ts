import { defineMessages } from "@/i18n/messages";

/** The read-only page a shared conversation link opens. */
export const sharedConversationMessages = defineMessages("sharedConversation", {
  title: "Shared conversation",
  snapshot: "Read-only snapshot",
  snapshotFrom: "Read-only snapshot · {date}",
  unavailable:
    "This shared conversation is unavailable or has been revoked. Ask the person who shared it for a new link.",
  loading: "Loading conversation…",
  empty: "No messages had been sent when this snapshot was created.",
  loadMore: "Load more messages",
  messageFrom: "Message from {name}",
  imageUnavailable: "Image unavailable: {filename}",
  loadingImage: "Loading image...",
});
