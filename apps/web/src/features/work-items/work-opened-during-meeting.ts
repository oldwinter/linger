import { chooseUpNext, meetingOpenPath } from "@/features/memory/up-next";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

/** A meeting still counts as underway for this long after it starts. */
const underwayMinutes = 90;

export interface WorkOpenedDuringMeeting {
  href: string;
  label: string;
  minutesIn: number;
}

/**
 * The meeting that was already underway when a Work Item was opened.
 * Uses the same ninety-minute window the Up next clock uses, applied to
 * the Work Item's creation time rather than to now.
 */
export function workOpenedDuringMeeting(
  entries: readonly TeamHubMemoryEntry[],
  createdAt: Date,
  tenantId: string,
): WorkOpenedDuringMeeting | undefined {
  const meeting = chooseUpNext(entries, createdAt);
  if (meeting?.phase !== "underway") return;
  const minutesIn = Math.min(
    underwayMinutes,
    Math.max(0, Math.floor((createdAt.getTime() - meeting.startMs) / 60_000)),
  );
  return {
    href: meetingOpenPath(tenantId, meeting.id),
    label: meeting.label,
    minutesIn,
  };
}

export function workOpenedDuringMeetingText(meeting: WorkOpenedDuringMeeting) {
  if (meeting.minutesIn === 0) return `Opened as ${meeting.label} began.`;
  const unit = meeting.minutesIn === 1 ? "minute" : "minutes";
  return `Opened ${meeting.minutesIn} ${unit} into ${meeting.label}.`;
}
