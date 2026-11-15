/** Who wrote a Thread Message, as the rows name them. */
export interface ThreadParticipant {
  id: string;
  name: string;
}

export interface ThreadSummary {
  /** Distinct authors in first-seen order, the root author first. */
  participants: string[];
  replyCount: number;
  /** A few names then the rest as "+N", for the header's single row. */
  short: string;
}

/** Names the header shows before it counts the rest. */
export const THREAD_SUMMARY_NAME_LIMIT = 2;

/** The header's words for how many replies a Thread has. */
export function threadReplyLabel(count: number): string {
  if (count === 0) return "No replies";
  return count === 1 ? "1 reply" : `${count} replies`;
}

/**
 * The header's facts about a Thread: how many replies it has and who wrote
 * them. Every author counts, the viewer included, because the app's other
 * participant lists (Room Document presence, reactions) do not drop the viewer.
 */
export function threadSummary({
  replies,
  rootAuthor,
}: {
  replies: readonly ThreadParticipant[];
  rootAuthor: ThreadParticipant;
}): ThreadSummary {
  const participants: string[] = [];
  const seen = new Set<string>();
  for (const author of [rootAuthor, ...replies]) {
    if (seen.has(author.id)) continue;
    seen.add(author.id);
    participants.push(author.name);
  }
  const visible = participants.slice(0, THREAD_SUMMARY_NAME_LIMIT);
  const hidden = participants.length - visible.length;
  return {
    participants,
    replyCount: replies.length,
    short: hidden > 0 ? `${visible.join(", ")} +${hidden}` : visible.join(", "),
  };
}
