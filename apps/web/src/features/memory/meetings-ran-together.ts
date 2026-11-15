import { formatMeetingWhen } from "./meetings-calendar";
import { meetingStartMs } from "./up-next";

/** A meeting still counts as underway for this long after it starts. */
const underwayMs = 90 * 60 * 1000;

export interface MeetingsRanTogether {
  earlier: string;
  later: string;
  minutesApart: number;
}

/**
 * The closest pair of meetings where the later one began while the earlier
 * one was still underway. The window is the same ninety minutes Up next uses.
 */
export function meetingsRanTogether(
  meetings: readonly { date: string; time: string }[],
): MeetingsRanTogether | undefined {
  const timed = meetings.flatMap((meeting) => {
    const path = `Meetings/${meeting.date.replaceAll("-", "/")}/Meeting ${meeting.time.replaceAll(":", "-")}`;
    const startMs = meetingStartMs(path);
    if (startMs === undefined) return [];
    return [
      {
        label: `Meeting · ${formatMeetingWhen(meeting.date, meeting.time)}`,
        startMs,
      },
    ];
  });
  timed.sort((left, right) => left.startMs - right.startMs);
  let closest: MeetingsRanTogether | undefined;
  for (let index = 1; index < timed.length; index += 1) {
    const gap = timed[index]!.startMs - timed[index - 1]!.startMs;
    if (gap <= 0 || gap >= underwayMs) continue;
    const minutesApart = Math.max(1, Math.round(gap / 60_000));
    if (closest && minutesApart >= closest.minutesApart) continue;
    closest = {
      earlier: timed[index - 1]!.label,
      later: timed[index]!.label,
      minutesApart,
    };
  }
  return closest;
}

export function meetingsRanTogetherText(overlap: MeetingsRanTogether) {
  const unit = overlap.minutesApart === 1 ? "minute" : "minutes";
  return `${overlap.later} began ${overlap.minutesApart} ${unit} after ${overlap.earlier}, while it was still underway.`;
}
