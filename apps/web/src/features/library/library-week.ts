import { formatMeetingDay } from "@/features/memory/meetings-calendar";

export interface LibraryWeekFile {
  date: string;
  id: string;
  owner: string;
  title: string;
}

export function libraryWeekPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/changed`;
}

/** Monday through Sunday that contain this calendar day. */
export function weekDates(today: string) {
  const day = new Date(`${today}T00:00:00Z`);
  const start = new Date(day);
  start.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

export function describeLibraryWeek(files: readonly LibraryWeekFile[]) {
  const byDay = new Map<string, LibraryWeekFile[]>();
  for (const file of files) {
    const day = byDay.get(file.date) ?? [];
    day.push(file);
    byDay.set(file.date, day);
  }
  const days = [...byDay.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([date, items]) => ({
      date,
      files: [...items].sort((left, right) =>
        left.title.localeCompare(right.title),
      ),
      label: formatMeetingDay(date),
    }));
  if (files.length === 0) {
    return {
      days,
      summary: "The library was quiet this week.",
    };
  }
  const fullest = [...days].sort(
    (left, right) =>
      right.files.length - left.files.length ||
      right.date.localeCompare(left.date),
  )[0]!;
  const summary =
    files.length === 1
      ? `1 file changed, on ${formatMeetingDay(files[0]!.date)}.`
      : `${files.length} files changed. ${fullest.label} held the most, with ${fullest.files.length}.`;
  return { days, summary };
}
