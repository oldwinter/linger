import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { reportDate } from "./wiki-period-reports";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Another year's Daily that falls on the anchor's month and day. */
export interface SameDayMemory {
  day: string;
  entry: TeamHubMemoryEntry;
  /** Positive when the report is from an earlier year. */
  yearsAgo: number;
}

/**
 * The memory the Wiki home features: the nearest earlier year on this
 * month and day, or the Daily from seven days before when no year matches.
 */
export interface MemoryRecall {
  day: string;
  entry: TeamHubMemoryEntry;
  /** Set for an earlier year. Absent for the week-before fallback. */
  yearsAgo?: number;
}

/** The calendar day in the viewer's zone, as `YYYY-MM-DD`. */
export function localCalendarDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function memoryRecallLabel(recall: MemoryRecall): string {
  if (recall.yearsAgo === undefined) return "A week ago";
  if (recall.yearsAgo === 1) return "A year ago";
  return `${recall.yearsAgo} years ago`;
}

function parsedDay(
  value: string,
): { year: number; monthDay: string } | undefined {
  const match = DAY.exec(value);
  if (!match) return;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return;
  return { year, monthDay: `${match[2]}-${match[3]}` };
}

function shiftDays(day: string, delta: number): string | undefined {
  const parsed = parsedDay(day);
  if (!parsed) return;
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));
  return shifted.toISOString().slice(0, 10);
}

/** One Daily per calendar day. A later write of the same day wins. */
function dailiesByDay(
  entries: readonly TeamHubMemoryEntry[],
): Map<string, TeamHubMemoryEntry> {
  const map = new Map<string, TeamHubMemoryEntry>();
  for (const entry of entries) {
    if (entry.kind !== "daily") continue;
    const day = reportDate(entry);
    if (!day) continue;
    const current = map.get(day);
    if (!current || current.updated_at < entry.updated_at) map.set(day, entry);
  }
  return map;
}

/**
 * Other years' Dailies on the anchor's month and day, nearest year first.
 * The anchor's own year is never included.
 */
export function sameCalendarDay(
  entries: readonly TeamHubMemoryEntry[],
  anchorDay: string,
): SameDayMemory[] {
  const anchor = parsedDay(anchorDay);
  if (!anchor) return [];
  const matches: SameDayMemory[] = [];
  for (const [day, entry] of dailiesByDay(entries)) {
    const parsed = parsedDay(day);
    if (
      !parsed ||
      parsed.monthDay !== anchor.monthDay ||
      parsed.year === anchor.year
    )
      continue;
    matches.push({ day, entry, yearsAgo: anchor.year - parsed.year });
  }
  matches.sort(
    (left, right) =>
      Math.abs(left.yearsAgo) - Math.abs(right.yearsAgo) ||
      right.yearsAgo - left.yearsAgo,
  );
  return matches;
}

/** The home-page memory for `anchorDay`, or nothing when no earlier day qualifies. */
export function featuredMemory(
  entries: readonly TeamHubMemoryEntry[],
  anchorDay: string,
): MemoryRecall | undefined {
  const earlier = sameCalendarDay(entries, anchorDay).find(
    (item) => item.yearsAgo > 0,
  );
  if (earlier)
    return {
      day: earlier.day,
      entry: earlier.entry,
      yearsAgo: earlier.yearsAgo,
    };
  const week = shiftDays(anchorDay, -7);
  const entry = week ? dailiesByDay(entries).get(week) : undefined;
  if (!week || !entry) return;
  return { day: week, entry };
}

/**
 * The newest Dailies to show beside a featured memory, so that memory is
 * not listed twice.
 */
export function reportsBesideRecall(
  entries: readonly TeamHubMemoryEntry[],
  recall: MemoryRecall | undefined,
  limit: number,
): TeamHubMemoryEntry[] {
  return entries
    .filter((entry) => {
      const day = reportDate(entry);
      return Boolean(day) && day !== recall?.day;
    })
    .slice(0, limit);
}
