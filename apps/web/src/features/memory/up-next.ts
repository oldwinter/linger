import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { meetingPath } from "./meeting-routes";
import { meetingStartMs, meetingWhen } from "./meeting-time";
import { formatMeetingWhen } from "./meetings-calendar";

export { meetingStartMs };

/** A meeting still counts as underway for this long after it starts. */
const underwayMs = 90 * 60 * 1000;
const soonMs = 15 * 60 * 1000;

export type UpNextPhase = "later" | "soon" | "underway";

export interface UpNextMeeting {
  id: string;
  label: string;
  phase: UpNextPhase;
  startMs: number;
}

export function upNextPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/up-next`;
}

/** The meeting happening now, or the next one that has not started. */
export function chooseUpNext(
  entries: readonly TeamHubMemoryEntry[],
  now: Date,
): UpNextMeeting | undefined {
  const nowMs = now.getTime();
  const timed = entries.flatMap((entry) => {
    const startMs = meetingStartMs(entry.path);
    const when = meetingWhen(entry.path);
    if (!entry.meeting || startMs === undefined || !when) return [];
    return [
      {
        id: entry.id,
        label: `Meeting · ${formatMeetingWhen(when.date, when.time)}`,
        startMs,
      },
    ];
  });
  const underway = timed
    .filter(
      (item) => item.startMs <= nowMs && nowMs - item.startMs < underwayMs,
    )
    .sort((left, right) => right.startMs - left.startMs)[0];
  if (underway) return { ...underway, phase: "underway" };
  const next = timed
    .filter((item) => item.startMs > nowMs)
    .sort((left, right) => left.startMs - right.startMs)[0];
  if (!next) return;
  return {
    ...next,
    phase: next.startMs - nowMs <= soonMs ? "soon" : "later",
  };
}

export function meetingOpenPath(tenantId: string, entryId: string) {
  return meetingPath(tenantId, entryId);
}

export function countdownClock(ms: number) {
  const remaining = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function countdownPhrase(ms: number) {
  if (ms <= 60_000) return "It starts now.";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) {
    return `It starts in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (rest === 0) return `It starts in ${hourLabel}.`;
  return `It starts in ${hourLabel} ${rest} ${rest === 1 ? "minute" : "minutes"}.`;
}

export function describeUpNext(meeting: UpNextMeeting | undefined, now: Date) {
  if (!meeting) {
    return {
      clock: undefined,
      detail: "No meeting is coming up.",
      headline: "The clock is clear.",
    };
  }
  if (meeting.phase === "underway") {
    return {
      clock: undefined,
      detail: "It started a little while ago.",
      headline: `${meeting.label} is underway.`,
    };
  }
  const ms = meeting.startMs - now.getTime();
  return {
    clock: countdownClock(ms),
    detail: countdownPhrase(ms),
    headline:
      meeting.phase === "soon"
        ? `${meeting.label} is close.`
        : `${meeting.label} is next.`,
  };
}
