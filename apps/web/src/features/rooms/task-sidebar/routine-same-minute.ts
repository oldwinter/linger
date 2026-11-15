import type { TeamHubScheduledRoutine } from "@/features/teamhub/teamhub-types";

/** Enabled routines that would fire in one minute, and the one that keeps the work. */
export interface SameMinuteRoutines {
  drop: TeamHubScheduledRoutine[];
  keep: TeamHubScheduledRoutine;
}

/**
 * The earliest minute in which more than one enabled routine would fire.
 * The oldest routine keeps the minute. The others would only repeat it.
 */
export function routinesInTheSameMinute(
  routines: readonly TeamHubScheduledRoutine[],
): SameMinuteRoutines | undefined {
  const buckets = new Map<number, TeamHubScheduledRoutine[]>();
  for (const routine of routines) {
    if (!routine.enabled || !routine.next_run_at) continue;
    const at = Date.parse(routine.next_run_at);
    if (!Number.isFinite(at)) continue;
    const minute = Math.floor(at / 60_000);
    const bucket = buckets.get(minute) ?? [];
    bucket.push(routine);
    buckets.set(minute, bucket);
  }
  const crowded = [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .find(([, bucket]) => bucket.length > 1)?.[1];
  if (!crowded) return undefined;
  const ordered = [...crowded].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
  const keep = ordered[0];
  const drop = ordered.slice(1);
  if (!keep || drop.length === 0) return undefined;
  return { drop, keep };
}

/** The kept routine's instruction, plus any other work from that minute. */
export function joinedRoutineInstruction(
  keep: TeamHubScheduledRoutine,
  drop: readonly TeamHubScheduledRoutine[],
): string {
  const parts: string[] = [];
  for (const text of [
    keep.instruction,
    ...drop.map((routine) => routine.instruction),
  ]) {
    const trimmed = text.trim();
    if (!trimmed || parts.includes(trimmed)) continue;
    parts.push(trimmed);
  }
  return parts.join("\n\n");
}
