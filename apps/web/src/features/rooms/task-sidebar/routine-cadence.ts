import type {
  TeamHubRoutine,
  TeamHubRoutineCadence,
  TeamHubScheduledRoutine,
} from "@/features/teamhub/teamhub-types";
import { type Translate, formatLocale, translate } from "@/i18n/language";

import { routinesMessages as m } from "./routines.messages";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type CadenceKind = TeamHubRoutineCadence["kind"];
export type EditableCadenceKind = Exclude<CadenceKind, "every_n_minutes">;

export interface RoutineDraft {
  instruction: string;
  kind: EditableCadenceKind;
  time: string;
  weekdays: (typeof WEEKDAYS)[number][];
  timezone: string;
  intervalHours: number;
  /** Local date-time (YYYY-MM-DDTHH:mm) for a once Routine. */
  runAt: string;
}

export const emptyRoutineDraft = (): RoutineDraft => ({
  instruction: "",
  kind: "daily",
  time: "09:00",
  weekdays: ["monday"],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  intervalHours: 1,
  runAt: "",
});

export function isScheduled(
  routine: TeamHubRoutine,
): routine is TeamHubScheduledRoutine {
  return routine.cadence !== undefined;
}

export function isEditableRoutine(routine: TeamHubScheduledRoutine): boolean {
  return routine.cadence.kind !== "every_n_minutes";
}

export function draftFromRoutine(
  routine: TeamHubScheduledRoutine,
): RoutineDraft {
  if (routine.cadence.kind === "every_n_minutes") {
    throw new Error(translate(m.minuteIntervalAgentOnly));
  }
  const hour = String(routine.cadence.hour ?? 9).padStart(2, "0");
  const minute = String(routine.cadence.minute ?? 0).padStart(2, "0");
  return {
    instruction: routine.instruction,
    kind: routine.cadence.kind,
    time: `${hour}:${minute}`,
    weekdays: routine.cadence.weekdays ?? ["monday"],
    timezone:
      routine.cadence.kind === "every_n_hours"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : routine.cadence.timezone,
    intervalHours: routine.cadence.interval_hours ?? 1,
    runAt: routine.cadence.run_at ? localDateTime(routine.cadence.run_at) : "",
  };
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function cadenceFromDraft(draft: RoutineDraft): TeamHubRoutineCadence {
  const timezone = draft.timezone;
  if (draft.kind === "once") {
    const runAt = new Date(draft.runAt);
    if (!draft.runAt || Number.isNaN(runAt.getTime()))
      throw new Error(translate(m.chooseWhen));
    return { kind: "once", timezone, run_at: runAt.toISOString() };
  }
  if (draft.kind === "every_n_hours") {
    return {
      kind: "every_n_hours",
      timezone,
      interval_hours: draft.intervalHours,
    };
  }
  const [hourRaw, minuteRaw] = draft.time.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (draft.kind === "weekly") {
    if (draft.weekdays.length === 0)
      throw new Error(translate(m.chooseWeekday));
    return {
      kind: "weekly",
      timezone,
      hour,
      minute,
      weekdays: WEEKDAYS.filter((day) => draft.weekdays.includes(day)),
    };
  }
  return { kind: "daily", timezone, hour, minute };
}

/**
 * A Routine's schedule as one sentence in the language on screen, such as
 * "Mon–Fri · 9:00 AM". Times and weekday names come from Intl.
 */
export function cadenceLabel(
  cadence: TeamHubRoutineCadence,
  t: Translate = translate,
) {
  if (cadence.kind === "every_n_minutes") {
    return t(m.everyMinutes, { count: cadence.interval_minutes ?? 10 });
  }
  if (cadence.kind === "every_n_hours") {
    return t(m.everyHours, { count: cadence.interval_hours ?? 1 });
  }
  if (cadence.kind === "once") {
    return cadence.run_at
      ? t(m.onceAt, { when: formatWhen(cadence.run_at) })
      : t(m.once);
  }
  const time = formatClock(cadence.hour ?? 0, cadence.minute ?? 0);
  if (cadence.kind === "daily") return t(m.dailyAt, { time });
  const days = cadence.weekdays ?? [];
  const ordered = WEEKDAYS.filter((day) => days.includes(day));
  if (ordered.length === 7) return t(m.everyDayAt, { time });
  if (ordered.join(",") === WEEKDAYS.slice(0, 5).join(",")) {
    return t(m.mondayToFridayAt, { time });
  }
  if (ordered.length === 0) return t(m.weeklyAt, { time });
  const width = ordered.length === 1 ? "long" : "short";
  return t(m.weekdaysAt, {
    days: ordered
      .map((day) => weekdayName(day, width))
      .join(t(m.weekdaySeparator)),
    time,
  });
}

/** The name of a weekday in the language on screen, such as "Monday" or "Mon". */
export function weekdayName(
  weekday: (typeof WEEKDAYS)[number],
  width: "long" | "short",
) {
  // 1 January 2024 was a Monday.
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: width,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(weekday))));
}

export function formatTimeOfDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : clockFormat().format(date);
}

/** "Today", "Tomorrow", or the date, plus how many days away it is. */
export function dayHeading(
  date: Date,
  now = new Date(),
  t: Translate = translate,
) {
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(now)) / 86_400_000);
  if (days <= 0) return { day: t(m.today), distance: "" };
  if (days === 1) return { day: t(m.tomorrow), distance: "" };
  return {
    day: new Intl.DateTimeFormat(formatLocale(), {
      month: "short",
      day: "numeric",
    }).format(date),
    distance: t(m.inDays, { count: days }),
  };
}

export function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(formatLocale(), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** A time of day such as "9:00 AM", in the language on screen. */
export function formatClock(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return clockFormat().format(date);
}

/** A whole hour such as "9 AM", in the language on screen. */
export function formatHour(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat(formatLocale(), { hour: "numeric" }).format(
    date,
  );
}

function clockFormat() {
  return new Intl.DateTimeFormat(formatLocale(), {
    hour: "numeric",
    minute: "2-digit",
  });
}
