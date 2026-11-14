const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A real calendar day, rejected when the month or day does not exist. */
export function isCalendarDay(
  value: string | null | undefined,
): value is string {
  if (!value || !DAY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Moves a calendar day by whole days. `2026-03-01` minus one is `2026-02-28`. */
export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date + delta))
    .toISOString()
    .slice(0, 10);
}

/**
 * The day the review shows. A missing or future day is today; a day before
 * today is kept. Undefined until today is known and nothing was requested.
 */
export function reviewDay(
  requested: string | null,
  today: string | undefined,
): string | undefined {
  if (today && isCalendarDay(requested) && requested <= today) return requested;
  if (today) return today;
  return isCalendarDay(requested) ? requested : undefined;
}
