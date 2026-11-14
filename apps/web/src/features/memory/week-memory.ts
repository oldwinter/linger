import { formatMeetingDay } from "./meetings-calendar";

export interface WeekMemoryDay {
  daily: boolean;
  date: string;
  meetings: number;
  note: boolean;
}

export function weekMemoryPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/week`;
}

/** Monday through Sunday that contain this calendar day. */
export function weekDays(today: string) {
  const day = new Date(`${today}T00:00:00Z`);
  const start = new Date(day);
  start.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

export function describeWeek(days: readonly WeekMemoryDay[]) {
  const meetings = days.reduce((sum, day) => sum + day.meetings, 0);
  const dailyDays = days.filter((day) => day.daily).length;
  const noteDays = days.filter((day) => day.note).length;
  if (meetings === 0 && dailyDays === 0 && noteDays === 0) {
    return {
      lines: [] as string[],
      summary: "This week is still open. No meetings, dailies, or notes yet.",
    };
  }
  const withMeetings = days.filter((day) => day.meetings > 0);
  const sentences: string[] = [];
  if (meetings === 0) sentences.push("No meetings.");
  else if (meetings === 1) {
    sentences.push(
      `You met once, on ${formatMeetingDay(withMeetings[0]!.date)}.`,
    );
  } else {
    sentences.push(`You met ${meetings} times.`);
    if (withMeetings.length > 1) {
      const fullest = [...withMeetings].sort(
        (left, right) =>
          right.meetings - left.meetings || right.date.localeCompare(left.date),
      )[0]!;
      sentences.push(
        `${formatMeetingDay(fullest.date)} was the fullest, with ${fullest.meetings} ${fullest.meetings === 1 ? "meeting" : "meetings"}.`,
      );
    }
  }
  sentences.push(
    dailyDays === 0
      ? "No daily was written."
      : dailyDays === 1
        ? "A daily was written on 1 day."
        : `A daily was written on ${dailyDays} days.`,
  );
  sentences.push(
    noteDays === 0
      ? "No notes were kept."
      : noteDays === 1
        ? "You kept a note on 1 day."
        : `You kept a note on ${noteDays} days.`,
  );
  const lines = days
    .filter((day) => day.meetings > 0 || day.daily || day.note)
    .map((day) => {
      const parts = [formatMeetingDay(day.date)];
      if (day.meetings > 0) {
        parts.push(
          `${day.meetings} ${day.meetings === 1 ? "meeting" : "meetings"}`,
        );
      }
      if (day.daily) parts.push("a daily");
      if (day.note) parts.push("a note");
      return parts.join(" · ");
    });
  return { lines, summary: sentences.join(" ") };
}
