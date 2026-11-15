import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { NavigateFunction } from "react-router";

import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { tenantRoomsQueryOptions } from "./room-queries";
import {
  AWAY_BEFORE_RETURN_MS,
  roomToOpenOnReturn,
  type RoomReturnFact,
} from "./return-to-arrived-room";

/**
 * After this window has been hidden long enough, open the one room that moved.
 * A crowd stays listed by the recap. Writing and an open dialog keep the page.
 */
export function useReturnToArrivedRoom({
  activeRoomId,
  client,
  queryClient,
  rooms,
  tenantId,
  navigate,
}: {
  activeRoomId?: string;
  client: TeamHubClient;
  navigate: NavigateFunction;
  queryClient: QueryClient;
  rooms: readonly TeamHubRoomListItem[] | undefined;
  tenantId: string;
}) {
  const hiddenAt = useRef<number | undefined>(undefined);
  const snapshot = useRef<RoomReturnFact[] | undefined>(undefined);
  const roomsRef = useRef(rooms);
  const activeRef = useRef(activeRoomId);

  useEffect(() => {
    roomsRef.current = rooms;
    activeRef.current = activeRoomId;
  }, [activeRoomId, rooms]);

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        snapshot.current = roomReturnFacts(roomsRef.current);
        return;
      }
      const leftAt = hiddenAt.current;
      const before = snapshot.current;
      hiddenAt.current = undefined;
      snapshot.current = undefined;
      if (leftAt === undefined || !before) return;
      const hiddenForMs = Date.now() - leftAt;
      if (hiddenForMs < AWAY_BEFORE_RETURN_MS) return;
      const active = activeRef.current;
      void (async () => {
        try {
          const fresh = await queryClient.fetchQuery(
            tenantRoomsQueryOptions(client, tenantId),
          );
          const next = roomToOpenOnReturn({
            activeRoomId: active,
            after: roomReturnFacts(fresh.items),
            before,
            dialogOpen: document.querySelector("dialog[open]") !== null,
            hiddenForMs,
            writing: personIsWriting(),
          });
          if (!next || activeRef.current !== active) return;
          void navigate(
            `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(next)}/chat`,
          );
        } catch {
          // A failed refresh leaves the person where they are.
        }
      })();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [client, navigate, queryClient, tenantId]);
}

function roomReturnFacts(
  rooms: readonly TeamHubRoomListItem[] | undefined,
): RoomReturnFact[] {
  return (rooms ?? []).map((room) => ({
    id: room.id,
    kind: room.kind,
    seq: room.latest_room_seq,
  }));
}

function personIsWriting() {
  const current = document.activeElement;
  return (
    current instanceof HTMLElement &&
    current.matches("input, textarea, [contenteditable='true']")
  );
}
