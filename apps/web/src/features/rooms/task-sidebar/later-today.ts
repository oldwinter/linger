const holdMs = 3 * 60 * 60 * 1000;

/**
 * A one-time reminder pushed three hours past the later of now and its current
 * time, when that moment is still today. Otherwise the reminder stays put.
 */
export function laterTodayRunAt(now: Date, runAt: string): Date | undefined {
  const current = new Date(runAt);
  if (Number.isNaN(current.getTime())) return;
  const later = new Date(Math.max(now.getTime(), current.getTime()) + holdMs);
  if (!sameLocalDay(now, later) || later.getTime() <= current.getTime()) return;
  return later;
}

function sameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
