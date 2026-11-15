import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomPage } from "@/features/teamhub/teamhub-types";

import { tenantRoomsQueryKey } from "../room-queries";
import { createRoomReadStateAdvancer } from "./room-read-state-advancer";

export function RoomReadStateSync({
  roomId,
  tenantId,
  throughRoomSeq,
}: {
  roomId: string;
  tenantId: string;
  throughRoomSeq: number;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const advancerRef = useRef<ReturnType<
    typeof createRoomReadStateAdvancer
  > | null>(null);
  // Messages that arrive while the window is hidden stay unread until the
  // person clicks, types, or scrolls. A hidden timeline would otherwise mark
  // them read before anyone sees them.
  const heldSeq = useRef<number | undefined>(undefined);
  const paused = useRef(false);

  // Create and dispose in one effect so a StrictMode or Activity remount gets
  // a live advancer instead of a disposed one that silently drops new seqs.
  useLayoutEffect(() => {
    const initialReadThroughRoomSeq =
      queryClient
        .getQueryData<TeamHubRoomPage>(tenantRoomsQueryKey(tenantId))
        ?.items.find((room) => room.id === roomId)?.read_through_room_seq ?? 0;
    const advancer = createRoomReadStateAdvancer({
      client,
      initialReadThroughRoomSeq,
      refreshRoomList: async (readThroughRoomSeq) => {
        const queryKey = tenantRoomsQueryKey(tenantId);
        // Reading through the latest event zeroes the counts exactly, so only
        // a partial read needs a reload for TeamHub to recount the rest.
        let exact = false;
        queryClient.setQueryData<TeamHubRoomPage>(queryKey, (current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            items: current.items.map((room) => {
              if (
                room.id !== roomId ||
                room.read_through_room_seq >= readThroughRoomSeq
              ) {
                return room;
              }
              const coversLatestRoomSeq =
                readThroughRoomSeq >= room.latest_room_seq;
              exact = coversLatestRoomSeq;
              return {
                ...room,
                read_through_room_seq: readThroughRoomSeq,
                unread_mention_count: coversLatestRoomSeq
                  ? 0
                  : room.unread_mention_count,
                unread_message_count: coversLatestRoomSeq
                  ? 0
                  : room.unread_message_count,
              };
            }),
          };
        });
        if (exact) return;
        await queryClient.invalidateQueries({
          exact: true,
          queryKey,
          refetchType: "none",
        });
        await queryClient.refetchQueries(
          { exact: true, queryKey, type: "all" },
          { throwOnError: true },
        );
      },
      roomId,
    });
    advancerRef.current = advancer;
    return () => {
      advancer.dispose();
      advancerRef.current = null;
    };
  }, [client, queryClient, roomId, tenantId]);

  useLayoutEffect(() => {
    if (document.hidden || paused.current) {
      heldSeq.current = throughRoomSeq;
      paused.current = true;
      return;
    }
    advancerRef.current?.advance(throughRoomSeq);
  }, [client, queryClient, roomId, tenantId, throughRoomSeq]);

  useEffect(() => {
    function pause() {
      if (!document.hidden) return;
      paused.current = true;
    }
    function resume() {
      if (document.hidden || !paused.current) return;
      paused.current = false;
      const seq = heldSeq.current;
      heldSeq.current = undefined;
      if (seq !== undefined) advancerRef.current?.advance(seq);
    }
    document.addEventListener("visibilitychange", pause);
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    document.addEventListener("wheel", resume);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      document.removeEventListener("wheel", resume);
    };
  }, []);

  return null;
}
