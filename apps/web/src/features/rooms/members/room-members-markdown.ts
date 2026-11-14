import type {
  TeamHubActorRef,
  TeamHubRoomMember,
} from "@/features/teamhub/teamhub-types";

/** The kind words the members view already shows for each Actor. */
function roomMemberKindLabel(kind: TeamHubActorRef["kind"]) {
  return kind === "agent" ? "Agent" : "Human";
}

/**
 * The Room's membership as a roster someone can paste into a report: the
 * Room's name, then one entry per member in the order the view lists them.
 */
export function roomMembersMarkdown(input: {
  members: readonly Pick<TeamHubRoomMember, "actor">[];
  roomName: string;
}) {
  const heading = `# ${input.roomName}`;
  if (!input.members.length) return heading;
  return [
    heading,
    "",
    ...input.members.map(
      ({ actor }) =>
        `- ${actor.display_name} (${roomMemberKindLabel(actor.kind)})`,
    ),
  ].join("\n");
}
