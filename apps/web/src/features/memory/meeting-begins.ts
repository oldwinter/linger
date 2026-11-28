import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { meetingStartMs } from "./meeting-time";

/** A late timer after sleep should not open a meeting that began long ago. */
export const MEETING_START_GRACE_MS = 2 * 60 * 1000;

export interface MeetingStart {
  id: string;
  startMs: number;
}

/** The soonest meeting that has not started yet. */
export function nextMeetingStart(
  entries: readonly TeamHubMemoryEntry[],
  nowMs: number,
): MeetingStart | undefined {
  let next: MeetingStart | undefined;
  for (const entry of entries) {
    if (!entry.meeting) continue;
    const startMs = meetingStartMs(entry.path);
    if (startMs === undefined || startMs <= nowMs) continue;
    if (!next || startMs < next.startMs) next = { id: entry.id, startMs };
  }
  return next;
}

/** The meeting page already open, when the URL names one. */
export function openMeetingId(pathname: string, search: string): string | null {
  if (!pathname.endsWith("/library/meetings")) return null;
  return new URLSearchParams(search).get("entry");
}

/**
 * Open the meeting at the moment it starts, while the person is somewhere
 * else. Writing and an open dialog keep the page they are on.
 */
export function shouldOpenMeetingAtStart({
  alreadyThere,
  dialogOpen,
  nowMs,
  startMs,
  visible,
  writing,
}: {
  alreadyThere: boolean;
  dialogOpen: boolean;
  nowMs: number;
  startMs: number;
  visible: boolean;
  writing: boolean;
}): boolean {
  if (!visible || alreadyThere || writing || dialogOpen) return false;
  const late = nowMs - startMs;
  return late >= 0 && late <= MEETING_START_GRACE_MS;
}
