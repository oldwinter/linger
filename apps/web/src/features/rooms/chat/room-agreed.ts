import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { messageSupportsReactions } from "./message-reactions/reaction-state";

/**
 * The newest ordinary message every person in the room has reacted to.
 * One person cannot agree with a room, and agents are not part of the count.
 */
export function roomAgreedMessage(
  messages: readonly TeamHubMessage[],
  humanIds: readonly string[],
): TeamHubMessage | undefined {
  if (humanIds.length < 2) return;
  const people = new Set(humanIds);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !messageSupportsReactions(message)) continue;
    if (!message.raw_message.trim()) continue;
    const reacted = new Set(
      message.reactions?.flatMap((reaction) => reaction.actor_ids) ?? [],
    );
    if ([...people].every((id) => reacted.has(id))) return message;
  }
  return;
}
