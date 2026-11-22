import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { isRoomNotice } from "./message-grouping";

/** Two messages this close, from different people, landed as one moment. */
export const SAME_MOMENT_MS = 3000;

/**
 * Indexes of messages that share the next message as one moment. A third
 * message that close starts a later moment instead of joining the pair.
 */
export function sameMomentStarts(
  messages: readonly TeamHubMessage[],
  excludedIndices?: ReadonlySet<number>,
): number[] {
  const starts: number[] = [];
  let index = 0;
  while (index < messages.length - 1) {
    if (excludedIndices?.has(index) || excludedIndices?.has(index + 1)) {
      index += 1;
      continue;
    }
    const current = messages[index];
    const next = messages[index + 1];
    if (current && next && saidTogether(current, next)) {
      starts.push(index);
      index += 2;
      continue;
    }
    index += 1;
  }
  return starts;
}

function saidTogether(earlier: TeamHubMessage, later: TeamHubMessage): boolean {
  if (isRoomNotice(earlier) || isRoomNotice(later)) return false;
  if (earlier.author.id === later.author.id) return false;
  const gap =
    new Date(later.created_at).getTime() -
    new Date(earlier.created_at).getTime();
  return gap >= 0 && gap <= SAME_MOMENT_MS;
}
