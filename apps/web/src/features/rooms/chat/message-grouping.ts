import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";
import { formatLocale, type Translation } from "@/i18n/language";
import { dateTimeFormat } from "@/lib/date-format";

import { settledCardNotice } from "../cards/card-notice";
import { knownRoomMessageCard } from "../cards/room-message-card";
import { chatMessages } from "./chat.messages";

const messageTimeFormatters = new Map<
  string,
  { date: Intl.DateTimeFormat; clock: Intl.DateTimeFormat }
>();

function messageTimeFormatter(locale: string) {
  let formatters = messageTimeFormatters.get(locale);
  if (!formatters) {
    formatters = {
      date: dateTimeFormat(
        { weekday: "long", month: "long", day: "numeric", year: "numeric" },
        locale,
      ),
      clock: dateTimeFormat({ hour: "numeric", minute: "2-digit" }, locale),
    };
    messageTimeFormatters.set(locale, formatters);
  }
  return formatters;
}

/** Conversation separator, e.g. "Friday, October 23, 2026 at 3:04 PM". */
export function formatMessageTime(
  timestamp: string,
  { language, t }: Translation,
) {
  const value = new Date(timestamp);
  const { date, clock } = messageTimeFormatter(formatLocale(language));
  return t(chatMessages.messageTime, {
    date: date.format(value),
    time: clock.format(value),
  });
}

export function messageStartsConversation(
  message: TeamHubMessage,
  previous?: TeamHubMessage,
) {
  return timeStartsConversation(message.created_at, previous?.created_at);
}

/** Five quiet minutes or a new day start a conversation. */
export function timeStartsConversation(
  current: string | number,
  previous?: string | number,
) {
  if (previous === undefined) return true;
  const currentDate = new Date(current);
  const previousDate = new Date(previous);
  return (
    currentDate.getTime() - previousDate.getTime() >= 5 * 60 * 1000 ||
    currentDate.toDateString() !== previousDate.toDateString()
  );
}

/** Card context Messages render inside their card, and runtime Messages never
 * render as rows. */
export function isTimelineMessage(message: TeamHubMessage) {
  return (
    !message.card_context_message_id && message.message_kind !== "agent_runtime"
  );
}

/** The Room Messages the timeline renders, in order. */
export function timelineMessages(
  messages: readonly TeamHubMessage[],
): TeamHubMessage[] {
  return messages.filter(isTimelineMessage);
}

/** A Room notice or a settled card's system line is a centered line, never
 * part of an author's group, so the next Message shows its author again. */
export function isRoomNotice(message: TeamHubMessage) {
  if (message.message_kind === "room_notice") return true;
  const card = knownRoomMessageCard(message.card);
  return Boolean(card && settledCardNotice(card, undefined));
}
