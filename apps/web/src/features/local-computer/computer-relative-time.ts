import { commonMessages } from "@/i18n/common.messages";
import { formatLocale, type Translation } from "@/i18n/language";

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormat(locale: string) {
  let format = relativeFormats.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormats.set(locale, format);
  }
  return format;
}

/**
 * "2 hours ago" for a past instant, used for when a Computer was last seen.
 * It follows the language of `translation`, and is English without one.
 */
export function relativeTime(value: string, translation?: Translation) {
  const format = relativeFormat(formatLocale(translation?.language ?? "en"));
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  }
  return translation
    ? translation.t(commonMessages.justNow)
    : commonMessages.justNow.source;
}
