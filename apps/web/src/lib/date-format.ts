import { commonMessages } from "@/i18n/common.messages";
import { formatLocale, type Translation } from "@/i18n/language";

export const APP_LOCALE = "en-US";

/**
 * Text that is translated passes the locale of the language on screen
 * (`formatLocale()` of `@/i18n/language`); everything else stays in English.
 */
export function dateTimeFormat(
  options?: Intl.DateTimeFormatOptions,
  locale: string = APP_LOCALE,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, options);
}

export function formatDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
  locale?: string,
): string {
  return dateTimeFormat(options, locale).format(new Date(value));
}

/** `YYYY-MM-DD` of the instant in the browser's time zone. Memory, Pocket Notes
 * and the Wiki partition days in the server's local zone; on one machine the
 * two are the same. */
export function dayKey(value: Date): string {
  const parts = dateTimeFormat({
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: string) {
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormatters.set(locale, formatter);
  }
  return formatter;
}

const relativeUnits = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const;
const RELATIVE_WINDOW_MS = 7 * 86_400_000;

/**
 * When something last changed, the one way lists and cards say it: "2 hours
 * ago" within a week, then "Nov 7", with the year only when it is not this one.
 * A translated surface passes its `translation`; without it the text is
 * English.
 */
export function formatUpdatedAt(
  value: Date | string | number,
  now = Date.now(),
  translation?: Translation,
): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const locale = translation ? formatLocale(translation.language) : APP_LOCALE;
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000)
    return translation ? translation.t(commonMessages.justNow) : "just now";
  if (elapsed < RELATIVE_WINDOW_MS) {
    const [unit, size] = relativeUnits.find(([, size]) => elapsed >= size)!;
    return relativeFormatter(locale).format(-Math.floor(elapsed / size), unit);
  }
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return dateTimeFormat(
    {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    },
    locale,
  ).format(time);
}
