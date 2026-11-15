import { timeStartsConversation } from "./message-grouping";

interface ConversationStretch {
  end: string;
  start: string;
}

/**
 * Conversations already split by five quiet minutes or a new day. The end is
 * the latest message still inside that stretch.
 */
function conversationStretches(
  messages: readonly { created_at: string }[],
): ConversationStretch[] {
  const stretches: ConversationStretch[] = [];
  for (const message of messages) {
    const current = stretches.at(-1);
    if (!current || timeStartsConversation(message.created_at, current.end)) {
      stretches.push({
        end: message.created_at,
        start: message.created_at,
      });
      continue;
    }
    if (message.created_at > current.end) current.end = message.created_at;
  }
  return stretches;
}

/**
 * The last message of the conversation before the one on screen. Absent when
 * this is already the earliest conversation.
 */
export function earlierConversationEnd(
  messages: readonly { created_at: string }[],
  asOf?: string,
): string | undefined {
  const stretches = conversationStretches(messages);
  if (stretches.length < 2) return;
  const viewed = asOf ? stretchIndex(stretches, asOf) : stretches.length - 1;
  if (viewed <= 0) return;
  return stretches[viewed - 1]?.end;
}

function stretchIndex(
  stretches: readonly ConversationStretch[],
  asOf: string,
): number {
  let found = -1;
  for (let index = 0; index < stretches.length; index += 1) {
    const stretch = stretches[index];
    if (stretch && stretch.end <= asOf) found = index;
  }
  return found;
}

/** When the conversation on screen began, so the room can say when it is. */
export function conversationBeganAt(
  messages: readonly { created_at: string }[],
  asOf: string,
): string | undefined {
  let began: string | undefined;
  let previous: string | undefined;
  for (const message of messages) {
    if (message.created_at > asOf) break;
    if (!previous || timeStartsConversation(message.created_at, previous)) {
      began = message.created_at;
    }
    if (!previous || message.created_at > previous)
      previous = message.created_at;
  }
  return began;
}
