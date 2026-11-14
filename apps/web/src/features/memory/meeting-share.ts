import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { meetingTitle } from "./meetings-calendar";

export interface MeetingShare {
  /** The meeting as Markdown, for one Room Message. */
  text: string;
  /** Changes when a new revision of the summary is written. */
  version: string;
}

/**
 * Reads a meeting as Markdown that stands alone away from the app: a heading
 * naming the meeting, the summary the reader shows, and the meeting's link.
 */
export function meetingShare({
  entry,
  url,
}: {
  entry: TeamHubMemoryEntry;
  url: string;
}): MeetingShare {
  // The reader drops the summary's own title and shows the meeting's instead.
  const summary = entry.content.replace(/^#[ \t]+[^\n]*\n?/mu, "").trim();
  return {
    text: [`# ${meetingTitle(entry)}`, summary || entry.summary.trim(), url]
      .filter(Boolean)
      .join("\n\n"),
    version: sanitized(`${entry.id}:${entry.updated_at}`),
  };
}

/** One Room Message per summary version and Room: retrying the same send
 * replays the first Message, while another Room gets its own. */
export function meetingShareIdempotencyKey(version: string, roomId: string) {
  return sanitized(`meeting-share:${version}:${roomId}`).slice(0, 128);
}

function sanitized(part: string) {
  return part.replace(/[^A-Za-z0-9._:-]/gu, "-");
}
