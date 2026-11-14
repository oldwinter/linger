import { dateTimeFormat } from "@/lib/date-format";
import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

/** One month's run of notes as the all-notes list shows them. */
export interface PocketNoteMonthGroup {
  /** The month itself, or `undated`; also the group's identity. */
  key: string;
  /** What the heading reads, for example "September 2026". */
  label: string;
  notes: TeamHubPocketNote[];
}

const undatedKey = "undated";
const undatedLabel = "Undated";
const monthLabel = dateTimeFormat({ month: "long", year: "numeric" });
const pageDay = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * The visible notes as month groups in their display order. Each run of notes
 * sharing a month becomes one group and no note moves within its group, so a
 * newest-first list reads as a timeline. A date TeamHub's page day cannot be
 * read from is kept in one group at the end rather than disappearing.
 */
export function groupPocketNotesByMonth(
  notes: readonly TeamHubPocketNote[],
): PocketNoteMonthGroup[] {
  const groups: PocketNoteMonthGroup[] = [];
  const undated: TeamHubPocketNote[] = [];
  let month: PocketNoteMonthGroup | undefined;
  for (const note of notes) {
    const day = readPageDay(note.date);
    if (!day) {
      undated.push(note);
      continue;
    }
    const key = `${day.year}-${String(day.month).padStart(2, "0")}`;
    if (month?.key !== key) {
      month = {
        key,
        label: monthLabel.format(new Date(day.year, day.month - 1, 1)),
        notes: [],
      };
      groups.push(month);
    }
    month.notes.push(note);
  }
  if (undated.length) {
    groups.push({ key: undatedKey, label: undatedLabel, notes: undated });
  }
  return groups;
}

/**
 * A Pocket Note date is the page day TeamHub chose, not an instant, so its
 * parts are read directly; the round trip rejects a day the calendar lacks.
 */
function readPageDay(
  date: string,
): { year: number; month: number } | undefined {
  const match = pageDay.exec(date);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDay = new Date(year, month - 1, day);
  if (
    calendarDay.getFullYear() !== year ||
    calendarDay.getMonth() !== month - 1 ||
    calendarDay.getDate() !== day
  ) {
    return undefined;
  }
  return { year, month };
}
