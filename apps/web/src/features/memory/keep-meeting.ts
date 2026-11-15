import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { meetingPath } from "./meeting-routes";
import { meetingShare } from "./meeting-share";
import { meetingTitle } from "./meetings-calendar";

export function keepMeetingPath(tenantId: string, meetingId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/meetings/keep?entry=${encodeURIComponent(meetingId)}`;
}

/** The summary words that become the page. A heading-only meeting has none. */
export function keepMeetingWords(entry: TeamHubMemoryEntry) {
  const summary = entry.content.replace(/^#[ \t]+[^\n]*\n?/mu, "").trim();
  return summary || entry.summary.trim();
}

export function keepMeetingFileName(title: string) {
  const cleaned = title
    .replace(/[^\w .,-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || "Meeting"}.md`;
}

export function keepMeetingMarkdown(
  entry: TeamHubMemoryEntry,
  pageUrl: string,
) {
  return meetingShare({ entry, url: pageUrl }).text;
}

export function keepMeetingIdempotencyKey(entry: TeamHubMemoryEntry) {
  return `meeting-page:${entry.id}:${entry.updated_at}`.replace(
    /[^A-Za-z0-9._:-]/gu,
    "-",
  );
}

export function keepMeetingDefaultTitle(entry: TeamHubMemoryEntry) {
  return meetingTitle(entry);
}

export function keptMeetingDocumentPath(tenantId: string, documentId: string) {
  return `/t/${encodeURIComponent(tenantId)}/documents/${encodeURIComponent(documentId)}`;
}

export function keepMeetingPageUrl(tenantId: string, meetingId: string) {
  return new URL(
    meetingPath(tenantId, meetingId),
    window.location.origin,
  ).toString();
}
