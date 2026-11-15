import { EMPTY_SECTION_TEXT } from "@linger/knowledge-format/sections";

import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";
import { parseMeetingSummary } from "./meeting-overview";

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** To-dos from a meeting summary. "None observed." is not a to-do. */
export function meetingTodoTexts(markdown: string): string[] {
  const block = parseMeetingSummary(markdown).find(
    (item) => item.kind === "outcomes" && item.title === "To-do list",
  );
  if (!block || block.kind !== "outcomes") return [];
  return block.outcomes
    .map((item) => [item.text, ...item.children].filter(Boolean).join("\n"))
    .map((text) => text.trim())
    .filter((text) => text && text !== EMPTY_SECTION_TEXT);
}

export function meetingRemindersPath(tenantId: string, meetingId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/meeting-reminders?entry=${encodeURIComponent(meetingId)}`;
}

export function meetingReminderLabel(entry: { path: string; title: string }) {
  const when = meetingWhen(entry.path);
  return when
    ? `Meeting ${formatMeetingWhen(when.date, when.time)}`
    : entry.title;
}

/** Tomorrow at 09:00, as a `datetime-local` value. */
export function defaultReminderLocalValue(now: Date): string {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
}

/** Local `datetime-local` value to an ISO timestamp, or null when it is not a time. */
export function localValueToRunAt(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function formatReminderWhen(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/u.exec(value);
  if (!match) return value;
  return `${months[Number(match[2]) - 1] ?? match[2]} ${Number(match[3])}, ${match[4]}:${match[5]}`;
}

/** Routine name; the server keeps at most 120 characters. */
export function reminderName(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= 120) return flat;
  return `${chars.slice(0, 119).join("")}…`;
}

export function reminderInstruction(
  meetingLabel: string,
  text: string,
): string {
  return `From ${meetingLabel}, remind me:\n\n${text.trim()}`;
}
