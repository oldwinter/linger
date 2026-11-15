import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { meetingWhen } from "./meetings-calendar";

/** Navigation state that means this page is the day's next recording. */
export function continuesRecording(
  state: unknown,
): state is { continueRecording: true } {
  return (
    typeof state === "object" &&
    state !== null &&
    "continueRecording" in state &&
    state.continueRecording === true
  );
}

interface DayRecording {
  id: string;
  time: string;
}

/**
 * The next recording on the same day, in folder order.
 * A meeting with no recording is not a place the day can continue.
 */
export function nextRecordingSameDay(
  entries: readonly TeamHubMemoryEntry[],
  currentId: string,
): string | undefined {
  const current = entries.find((entry) => entry.id === currentId);
  const when = current ? meetingWhen(current.path) : undefined;
  if (!current?.meeting || !when) return undefined;
  const day: DayRecording[] = [];
  for (const entry of entries) {
    const next = meetingWhen(entry.path);
    if (
      !entry.meeting?.recording_document_id ||
      !next ||
      next.date !== when.date
    )
      continue;
    day.push({ id: entry.id, time: next.time });
  }
  day.sort(
    (left, right) =>
      left.time.localeCompare(right.time) || left.id.localeCompare(right.id),
  );
  const index = day.findIndex((item) => item.id === currentId);
  return index < 0 ? undefined : day[index + 1]?.id;
}
