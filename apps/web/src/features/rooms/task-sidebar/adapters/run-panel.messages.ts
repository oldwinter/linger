import { defineMessages } from "@/i18n/messages";

/**
 * A Runtime's own record of a Run, step by step: what it thought, the
 * commands and tools it called and what it replied. Commands, paths, queries,
 * tool names and output are data and are shown as the Runtime wrote them.
 */
export const runPanelMessages = defineMessages("runPanel", {
  input: "Input",
  output: "Output",
  changes: "Changes",
  toolCall: "Tool call",
  noMessageText: "No message text recorded",
  thinkingHidden: "Thinking recorded · private content hidden",
  // One step of a Run: <detail> wraps what it acted on (a command, a path,
  // a search, a URL or a tool name), which keeps its own text.
  ran: "Ran <detail>{detail}</detail>",
  read: "Read <detail>{detail}</detail>",
  edited: "Edited <detail>{detail}</detail>",
  wrote: "Wrote <detail>{detail}</detail>",
  searched: "Searched <detail>{detail}</detail>",
  listed: "Listed <detail>{detail}</detail>",
  fetched: "Fetched <detail>{detail}</detail>",
  delegated: "Delegated <detail>{detail}</detail>",
  called: "Called <detail>{detail}</detail>",
  // What an edit acted on when its patch names no file.
  files: "files",
  // A search and the folder it looked in.
  searchIn: "{query} in {scope}",
});
