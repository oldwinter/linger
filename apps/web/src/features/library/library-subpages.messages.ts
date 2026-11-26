import { defineMessages } from "@/i18n/messages";

/** Lazy messages for the Library subpage shell and weekly changes subpage. */
export const librarySubpagesMessages = defineMessages("librarySubpages", {
  openLibraryPages: "Open Library pages",
  libraryPagesTitle: "Library pages",
  backToLibrary: "Back to the library",
  weekInMemory: "The week in memory",
  weekTitle: "What changed this week",
  weekSubtitle:
    "{from} through {to}. Files in the library, from the whole week.",
  loadingLibrary: "Loading the library.",
  loadFailed: "The library could not be loaded.",
  moreChanges: "There are more changes than this list holds.",
});
