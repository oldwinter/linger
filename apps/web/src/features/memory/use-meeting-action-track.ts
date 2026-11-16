import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import {
  readRoomComposerDraft,
  writeRoomComposerDraft,
} from "@/features/rooms/room-drafts";
import {
  anotherMeQueryOptions,
  teamHubIdentityQueryOptions,
} from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  draftWithTrackedAction,
  meetingActionBlock,
} from "./meeting-action-track";
import { meetingPath } from "./meeting-routes";

/**
 * A Track handler that stages one meeting Action in the Another Me Chat as an
 * unsent draft, leaving an existing draft's text in place ahead of it, and opens
 * that Chat asking for composer focus. Undefined while the Another Me has no
 * actor or Room, so no button offers a Chat that cannot open.
 */
export function useMeetingActionTrack(input: {
  meetingId: string;
  meetingTitle: string;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const navigate = useNavigate();
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const anotherMe = useQuery(anotherMeQueryOptions(client, input.tenantId));
  const roomId = anotherMe.data?.agent_actor_id
    ? anotherMe.data.room_id
    : undefined;
  const accountId = identity.data?.account.id;
  if (!roomId || !accountId) return undefined;

  return (action: string) => {
    const scope = { accountId, roomId, tenantId: input.tenantId };
    const draft = readRoomComposerDraft(scope);
    writeRoomComposerDraft(scope, {
      ...draft,
      body: draftWithTrackedAction(
        draft.body,
        meetingActionBlock({
          action,
          meetingLink: new URL(
            meetingPath(input.tenantId, input.meetingId),
            window.location.origin,
          ).toString(),
          meetingTitle: input.meetingTitle,
        }),
      ),
    });
    void navigate(
      `/t/${encodeURIComponent(input.tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`,
      { state: { focusComposer: true } },
    );
  };
}
