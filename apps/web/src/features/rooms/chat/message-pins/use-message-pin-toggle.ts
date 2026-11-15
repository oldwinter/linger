import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { teamHubDone } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { roomPinsQueryKey } from "../../room-queries";

/**
 * Toggles one Message in the Room's Pinned list, then rereads the authoritative
 * list. A Message already in the requested state changes nothing on TeamHub.
 */
export function useMessagePinToggle(input: {
  client: TeamHubClient;
  queryClient: QueryClient;
  tenantId: string;
  roomId: string;
}) {
  const { client, queryClient, roomId, tenantId } = input;
  return useCallback(
    async (message: TeamHubMessage, pinned: boolean) => {
      const params = { path: { roomId, messageId: message.id } };
      try {
        if (pinned)
          await teamHubDone(
            client.api.DELETE("/v0/rooms/{roomId}/messages/{messageId}/pin", {
              params,
            }),
          );
        else
          await teamHubDone(
            client.api.PUT("/v0/rooms/{roomId}/messages/{messageId}/pin", {
              params,
            }),
          );
      } finally {
        // A failed write still rereads the authoritative list, so the action
        // and the Pinned panel never disagree with TeamHub.
        await queryClient.invalidateQueries({
          queryKey: roomPinsQueryKey(tenantId, roomId),
        });
      }
    },
    [client, queryClient, roomId, tenantId],
  );
}
