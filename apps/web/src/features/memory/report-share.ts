import {
  EMPTY_SECTION_TEXT,
  REPORT_SOURCES_SECTION,
} from "@linger/knowledge-format/sections";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { parseDailyReport, plain } from "@/features/wiki/wiki-daily-card";

import { periodLabel, type PeriodReportKind } from "./wiki-period-reports";

export interface ReportShare {
  /** The report as Markdown, for the clipboard and one Room Message. */
  text: string;
  /** Changes when a new revision of the report is written. */
  version: string;
}

type ShareableReport = Pick<
  TeamHubMemoryEntry,
  "content" | "id" | "summary" | "updated_at"
>;

interface ReportSection {
  heading: string;
  lines: string[];
}

const emptySectionText = plain(EMPTY_SECTION_TEXT);

/**
 * Reads a report as Markdown that stands alone away from the app: its period
 * as the title, then every section that has content. Frontmatter, the report's
 * own title, source links, and its Sources section stay behind.
 */
export function reportShare({
  day,
  entry,
  kind,
}: {
  day: string;
  entry: ShareableReport;
  kind: PeriodReportKind;
}): ReportShare {
  const label = kind === "daily" ? "Daily" : "Weekly";
  const body = entry.content.replace(/^---\n[\s\S]*?\n---\n/u, "");
  const title = `# ${label} report for ${periodLabel(day, kind)}`;
  const sections = body
    .split(/^## /mu)
    .slice(1)
    .map(readSection)
    .filter((section): section is ReportSection => Boolean(section));
  return {
    text: sections.length
      ? [title, ...sections.map(renderSection)].join("\n\n")
      : summaryText(body, entry, title),
    version: versionOf(entry),
  };
}

/** One Room Message per report version: sending the same version again
 * replays the first Message instead of posting a second one. */
export function reportShareIdempotencyKey(version: string, roomId: string) {
  return sanitized(`report-share:${version}:${roomId}`).slice(0, 128);
}

function readSection(chunk: string): ReportSection | undefined {
  const [head = "", ...rest] = chunk.split("\n");
  const heading = plain(head);
  const lines = bodyLines(rest);
  if (!heading || heading === REPORT_SOURCES_SECTION) return;
  if (!lines.some((line) => line && !isEmptySectionLine(line))) return;
  return { heading, lines };
}

// Blank lines separate paragraphs and subheadings; runs of them and the
// section's trailing break collapse to one readable gap.
function bodyLines(raw: string[]) {
  const lines: string[] = [];
  for (const rawLine of raw) {
    const line = plain(rawLine);
    if (line) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  }
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function isEmptySectionLine(line: string) {
  return line === emptySectionText || line === `- ${emptySectionText}`;
}

function renderSection({ heading, lines }: ReportSection) {
  return `## ${heading}\n\n${lines.join("\n")}`;
}

// A report without sections still has a readable one-liner in its
// frontmatter description, its summary, or its first Work item.
function summaryText(body: string, entry: ShareableReport, title: string) {
  const markdown = body.replace(/^# .*$/mu, "").trim();
  if (!body.trim() && !entry.summary.trim()) return "";
  const summary =
    plain(markdown) || plain(entry.summary) || parseDailyReport(entry).summary;
  return `${title}\n\n${summary}`;
}

function versionOf(entry: ShareableReport) {
  return sanitized(`${entry.id}:${entry.updated_at}`);
}

function sanitized(part: string) {
  return part.replace(/[^A-Za-z0-9._:-]/gu, "-");
}
