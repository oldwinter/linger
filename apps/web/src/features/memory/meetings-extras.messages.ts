import { defineMessages } from "@/i18n/messages";

/**
 * The headings the meeting reader writes itself over a Session page. Section
 * titles that come from the page stay as the page wrote them.
 */
export const meetingsExtrasMessages = defineMessages("meetingsExtras", {
  meetingSummary: "Meeting Summary",
  // The Action Items section, shown as the meeting's to-do list.
  todoList: "To-do list",
  noneObserved: "None observed.",
});
