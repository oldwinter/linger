// Meeting folders are named in the server's local time; the calendar and
// meeting-start timer use the same dates so a meeting sits on the same day.
const meetingPathPattern =
  /^Meetings\/(\d{4})\/(\d{2})\/(\d{2})\/Meeting (\d{2})-(\d{2})-(\d{2})/u;

export interface MeetingWhen {
  date: string;
  time: string;
}

/** The date and start time a meeting's folder path names. */
export function meetingWhen(path: string): MeetingWhen | undefined {
  const match = meetingPathPattern.exec(path);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
  };
}

/** The folder time is a local clock time, same as the meetings calendar. */
export function meetingStartMs(path: string): number | undefined {
  const when = meetingWhen(path);
  if (!when) return;
  const [year, month, day] = when.date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [hour, minute, second] = when.time.split(":").map(Number) as [
    number,
    number,
    number,
  ];
  const start = new Date(year, month - 1, day, hour, minute, second);
  const ms = start.getTime();
  return Number.isFinite(ms) ? ms : undefined;
}
