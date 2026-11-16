import { dayKey } from "@/lib/date-format";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

/**
 * The question you asked yesterday that nobody has answered and that you have
 * not spoken after. The latest such question is the one that leads.
 */
export function leadingYesterdayQuestion(
  messages: readonly TeamHubMessage[],
  selfId: string | undefined,
  now: Date,
): string | undefined {
  if (!selfId) return;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);
  const ordered = [...messages].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
  const answered = new Set(
    ordered.flatMap((message) =>
      message.reply_to_message_id ? [message.reply_to_message_id] : [],
    ),
  );
  let leading: string | undefined;
  for (const message of ordered) {
    if (
      message.author.id !== selfId ||
      message.message_kind !== "conversation" ||
      dayKey(new Date(message.created_at)) !== yesterdayKey ||
      !message.raw_message.trim().endsWith("?")
    ) {
      continue;
    }
    const spokeLater = ordered.some(
      (later) =>
        later.id !== message.id &&
        later.author.id === selfId &&
        later.created_at > message.created_at,
    );
    if (spokeLater || answered.has(message.id)) continue;
    leading = message.id;
  }
  return leading;
}
