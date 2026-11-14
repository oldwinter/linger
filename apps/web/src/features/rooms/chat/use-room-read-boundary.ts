import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { TeamHubRoomPage } from "@/features/teamhub/teamhub-types";

import { tenantRoomsQueryKey } from "../room-queries";

/** The Room's read boundary captured when the Room opened. */
export interface RoomReadBoundary {
  readThroughRoomSeq: number;
}

/**
 * Captures the Room's read boundary on the render that opens it, because
 * read-state sync advances the Room list right after that.
 *
 * The Room list is the only read model that carries the cursor. A missing row
 * leaves no boundary, so the timeline shows no divider instead of guessing.
 */
export function useRoomReadBoundary(
  tenantId: string,
  roomId: string,
): RoomReadBoundary | undefined {
  const queryClient = useQueryClient();
  const [boundary] = useState<RoomReadBoundary | undefined>(() => {
    const room = queryClient
      .getQueryData<TeamHubRoomPage>(tenantRoomsQueryKey(tenantId))
      ?.items.find((item) => item.id === roomId);
    if (!room) return undefined;
    return { readThroughRoomSeq: room.read_through_room_seq };
  });
  return boundary;
}
