import { dateTimeFormat } from "@/lib/date-format";

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Date-only label for Work Item cards and metadata, formatted in UTC. */
export function formatWorkItemDate(value: string, locale: string) {
  return dateTimeFormat(
    { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" },
    locale,
  ).format(new Date(value));
}

/** Comment timestamp formatted in the viewer's local timezone. */
export function formatWorkItemCommentTime(value: string, locale: string) {
  return dateTimeFormat(
    {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
    },
    locale,
  ).format(new Date(value));
}
