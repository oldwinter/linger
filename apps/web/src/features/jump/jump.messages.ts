import { defineMessages } from "@/i18n/messages";

/** The Jump page: quick navigation to rooms, meetings, and library places. */
export const jumpMessages = defineMessages("jump", {
  title: "Jump",
  subtitle:
    "Open a room, a meeting, or a part of the library. This does not search what was said.",
  searchHint:
    "Tip: Press {shortcut} to search messages, docs, and run commands.",
  fieldLabel: "Where do you want to go?",
  placeholder: "A room, a meeting, Wiki, Library",
  loadFailedAll: "Places could not be loaded.",
  loadFailedRooms: "Rooms could not be loaded.",
  loadFailedMeetings: "Meetings could not be loaded.",
  loading: "Loading places.",
  noMatch: "Nothing matches that.",
  placesLabel: "Places",
});
