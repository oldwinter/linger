import { meetingDecisions } from "./carry-decision";
import { parseMeetingSummary } from "./meeting-overview";

/**
 * The summary wrote outcomes and none of them is a decision. A summary that
 * does not use that section is left as it is.
 */
export function meetingEndedWithoutDecision(content: string): boolean {
  if (meetingDecisions(content).length > 0) return false;
  const markdown = content.replace(/^#[ \t]+[^\n]*\n?/mu, "");
  return parseMeetingSummary(markdown).some(
    (block) => block.kind === "outcomes",
  );
}

/** Where a meeting opens. A finished meeting with no decision opens on the transcript. */
export function meetingReadingTab(
  file: string | null,
  summaryReady: boolean,
  content: string,
): "summary" | "transcript" {
  if (file === "summary" || file === "transcript") return file;
  if (summaryReady && !meetingEndedWithoutDecision(content)) return "summary";
  return "transcript";
}

/** The default open of a decision-less meeting lands on the last words said. */
export function meetingOpensOnLastWords(
  file: string | null,
  summaryReady: boolean,
  content: string,
): boolean {
  return (
    file !== "summary" &&
    file !== "transcript" &&
    summaryReady &&
    meetingEndedWithoutDecision(content)
  );
}
