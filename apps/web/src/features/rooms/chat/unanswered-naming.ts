import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

/**
 * Long enough that a reply in the conversation would have landed. The
 * five-minute break that starts a new stretch of messages is a different pause.
 */
export const unansweredNamingWaitMs = 60 * 60 * 1000;

/** The latest person you named who has not spoken since, and when the wait ends. */
export interface UnansweredNaming {
  actorId: string;
  dueAt: number;
  message: TeamHubMessage;
}

/**
 * The latest conversation message you sent that names exactly one other
 * person, while that person has not spoken since. A later naming replaces an
 * earlier one. Naming several people is left alone.
 */
export function latestUnansweredNaming(
  messages: readonly TeamHubMessage[],
  selfId: string | undefined,
): UnansweredNaming | undefined {
  if (!selfId) return;
  const ordered = [...messages].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
  let naming: UnansweredNaming | undefined;
  for (const message of ordered) {
    if (
      naming &&
      message.message_kind === "conversation" &&
      message.author.id === naming.actorId &&
      message.created_at > naming.message.created_at
    ) {
      naming = undefined;
    }
    if (message.author.id !== selfId || message.message_kind !== "conversation")
      continue;
    const named = namedActorIds(message, selfId);
    if (named.length !== 1) continue;
    const created = Date.parse(message.created_at);
    if (!Number.isFinite(created)) continue;
    const actorId = named[0];
    if (!actorId) continue;
    naming = {
      actorId,
      dueAt: created + unansweredNamingWaitMs,
      message,
    };
  }
  return naming;
}

function namedActorIds(message: TeamHubMessage, selfId: string) {
  const ids: string[] = [];
  for (const segment of message.segments) {
    if (segment.type !== "reference" || segment.target === selfId) continue;
    if (!ids.includes(segment.target)) ids.push(segment.target);
  }
  return ids;
}
