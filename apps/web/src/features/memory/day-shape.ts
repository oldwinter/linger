/** The clock starts at 08:00 and runs through 19:00 unless a meeting sits outside it. */
const dayStart = 8 * 60;
const dayEnd = 19 * 60;

export interface DayShapeMeeting {
  id: string;
  /** `HH:MM:SS` from the meeting folder. */
  time: string;
}

export interface DaySegment {
  kind: "open" | "meeting";
  /** Where an open stretch sits relative to the meetings. */
  place?: "before" | "between" | "after";
  minutes: number;
  from: string;
  to: string;
  meetingId?: string;
}

export interface DayShape {
  segments: DaySegment[];
  summary: string;
}

export function dayShapePath(tenantId: string, date: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/day-shape?date=${encodeURIComponent(date)}`;
}

/** Shift a `YYYY-MM-DD` calendar day. The date is not a timezone instant. */
export function shiftDay(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function isCalendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

/**
 * One day as open stretches and meeting marks. A meeting is a point in time;
 * the open minutes are the gaps around it, so the picture is the day's shape
 * rather than another list of titles.
 */
export function dayShape(meetings: readonly DayShapeMeeting[]): DayShape {
  const points = meetings
    .flatMap((meeting) => {
      const minutes = minutesOf(meeting.time);
      return minutes === undefined ? [] : [{ ...meeting, minutes }];
    })
    .sort((left, right) => left.minutes - right.minutes);
  const start = points.reduce(
    (earliest, meeting) =>
      Math.min(earliest, Math.floor(meeting.minutes / 60) * 60),
    dayStart,
  );
  const end = points.reduce(
    (latest, meeting) =>
      Math.max(latest, Math.ceil((meeting.minutes + 1) / 60) * 60),
    dayEnd,
  );
  const segments: DaySegment[] = [];
  let cursor = start;
  let seenMeeting = false;
  for (const meeting of points) {
    if (meeting.minutes > cursor) {
      segments.push(
        openSegment(
          cursor,
          meeting.minutes,
          seenMeeting ? "between" : "before",
        ),
      );
    }
    segments.push({
      kind: "meeting",
      minutes: 1,
      from: clock(meeting.minutes),
      to: clock(meeting.minutes),
      meetingId: meeting.id,
    });
    seenMeeting = true;
    cursor = meeting.minutes;
  }
  if (cursor < end) segments.push(openSegment(cursor, end, "after"));
  return { segments, summary: shapeSummary(points, segments) };
}

export function openStretchPhrase(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 0 ? "" : hours === 1 ? "1 hour" : `${hours} hours`;
  const minutePart = rest === 0 ? "" : rest === 1 ? "1 min" : `${rest} min`;
  return `${[hourPart, minutePart].filter(Boolean).join(" ")} open`;
}

function shapeSummary(
  points: readonly { minutes: number }[],
  segments: readonly DaySegment[],
) {
  if (points.length === 0) return "The day is open.";
  if (points.length === 1) {
    return `One meeting, at ${clock(points[0]!.minutes)}. The rest of the day is open.`;
  }
  const longest = segments
    .filter((segment) => segment.place === "between")
    .reduce<
      DaySegment | undefined
    >((best, segment) => (!best || segment.minutes > best.minutes ? segment : best), undefined);
  const count = `${points.length} meetings`;
  if (!longest || longest.minutes < 60)
    return `${count}. They sit close together.`;
  return `${count}. The longest open stretch is ${openStretchPhrase(longest.minutes).replace(/ open$/u, "")}, from ${longest.from} to ${longest.to}.`;
}

function openSegment(
  from: number,
  to: number,
  place: NonNullable<DaySegment["place"]>,
): DaySegment {
  return {
    kind: "open",
    place,
    minutes: to - from,
    from: clock(from),
    to: clock(to),
  };
}

function minutesOf(time: string) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/u.exec(time);
  if (!match) return;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return;
  return hour * 60 + minute;
}

function clock(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
