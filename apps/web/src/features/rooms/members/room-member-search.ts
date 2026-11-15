import {
  matchesSearchQuery,
  normalizeSearchQuery,
} from "@/features/search/search-text";

/** What the members list needs of a member: the name it shows. */
export interface RoomMemberSearchTarget {
  actor: { display_name: string };
}

export interface RoomMemberSearchResult<Member> {
  count: number;
  /** The matching members in their existing order. */
  items: Member[];
}

/**
 * The members whose displayed name holds every word of the query,
 * case-insensitively. An empty query keeps every member, so clearing restores
 * the full roster.
 */
export function searchRoomMembers<Member extends RoomMemberSearchTarget>(
  members: readonly Member[],
  query: string,
): RoomMemberSearchResult<Member> {
  const words = normalizeSearchQuery(query).split(/\s+/u).filter(Boolean);
  const items = words.length
    ? members.filter((member) =>
        words.every((word) =>
          matchesSearchQuery(word, [member.actor.display_name]),
        ),
      )
    : [...members];
  return { count: items.length, items };
}
