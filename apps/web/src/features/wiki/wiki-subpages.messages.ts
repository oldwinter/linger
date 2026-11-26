import { defineMessages } from "@/i18n/messages";

/**
 * Lazy messages for Wiki companion subpages: Remembered, Introduction, Life,
 * and Wiki Writing Walk.
 */
export const wikiSubpagesMessages = defineMessages("wikiSubpages", {
  backToProfile: "Back to Profile",
  backToWiki: "Back to Wiki",

  // Remembered page.
  rememberedTitle: "What Another Me remembers",
  rememberedSubtitle:
    "The current profile beside the previous one, so you can see what changed.",
  loadingRemembered: "Loading what Another Me remembers.",
  rememberedLoadFailed: "Could not load what Another Me remembers.",
  noProfileYet: "Another Me has not written a profile yet.",
  changesSincePrevious: {
    one: "{count} change since the previous profile.",
    other: "{count} changes since the previous profile.",
  },
  nothingChanged: "Nothing has changed since the previous profile.",
  firstProfile: "This is the first profile Another Me has written.",
  addedLabel: "Added {label}",
  removedLabel: "Removed {label}",
  nowValue: "Now: {value}",
  beforeValue: "Before: {value}",

  // Introduction page.
  introTitle: "How Another Me would introduce you",
  introSubtitle:
    "A few lines from what Another Me remembers, in an order you would actually show someone.",
  loadingIntro: "Loading your introduction.",
  introLoadFailed: "Could not load your introduction.",
  notEnoughToIntroduce:
    "Another Me has not written enough to introduce you yet.",
  openingLine: "Opening line",
  leadPerson: "Lead with who you are",
  leadTalk: "Lead with how to talk to you",
  leadWork: "Lead with how you work",
  introArticleLabel: "Introduction",
  noteFullError: "Today's note is full, so this introduction does not fit.",
  noteUpdateFailed: "Today's note could not be updated.",
  onTodaysNote: "It is on today's note.",
  leavingOnNote: "Leaving it",
  leaveOnTodaysNote: "Leave this on today's note",

  // Life page & chapter viewer.
  lifeTitle: "How Another Me would tell your life",
  lifeSubtitle:
    "The years Another Me remembers, from the earliest, as lines you could say out loud.",
  loadingLife: "Loading your life.",
  noLifeYet: "Another Me has not written a life yet.",
  lifeChapter: "Life chapter",
  thatsTheLife: "That's the life Another Me would tell.",
  chapterOf: "Chapter {current} of {total}",
  earlierChapter: "Earlier chapter",
  laterChapter: "Later chapter",

  // Wiki writing walk page.
  writingTitle: "Pages being written",
  writingNotReady: "Another Me is writing. No page is ready yet.",
  notWritingNow: "Another Me is not writing the Wiki right now.",
  readPagesSoFar: "You've read the pages written so far.",
  stillWriting: "Another Me is still writing.",
  pagesInWikiNow: "Those pages are in the Wiki now.",
  checkForNewPages: "Check for new pages",
  pageOfCollection: "{current} of {total} · {collection}",
  openPage: "Open page",
  previous: "Previous",
  next: "Next",
  finish: "Finish",
});
