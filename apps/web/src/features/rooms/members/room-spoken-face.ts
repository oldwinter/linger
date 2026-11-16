import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";

/**
 * The sidebar mosaic leads with whoever spoke last. Membership order stays
 * underneath, and a Room with no faces yet keeps its empty mark.
 */
export function spokenRoomFace(
  members: readonly TeamHubActorRef[],
  author: TeamHubActorRef | undefined,
): TeamHubActorRef[] {
  if (!author || members.length === 0 || members[0]?.id === author.id) {
    return [...members];
  }
  return [author, ...members.filter((member) => member.id !== author.id)];
}
