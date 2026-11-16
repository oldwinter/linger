import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

/** Adjacent answers from different agents to the same message. */
export interface AgentAnswerPair {
  end: number;
  parentId: string;
  start: number;
}

/**
 * Agents that answer the same message sit together, even when time has passed
 * between them. A run stops at a person, a notice, a different message, or
 * the same agent speaking again.
 */
export function pairedAgentAnswers(
  messages: readonly TeamHubMessage[],
): AgentAnswerPair[] {
  const pairs: AgentAnswerPair[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    const parentId = message?.reply_to_message_id;
    if (!message || message.author.kind !== "agent" || !parentId) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < messages.length) {
      const next = messages[end + 1];
      const current = messages[end];
      if (
        !next ||
        !current ||
        next.author.kind !== "agent" ||
        next.author.id === current.author.id ||
        next.reply_to_message_id !== parentId
      ) {
        break;
      }
      end += 1;
    }
    if (end > index) {
      pairs.push({ end, parentId, start: index });
      index = end + 1;
    } else {
      index += 1;
    }
  }
  return pairs;
}
