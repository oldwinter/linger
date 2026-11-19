import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { NavigateFunction } from "react-router";

import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  quietRoomIds,
  readRoomMentionMute,
  readRoomMentionSnooze,
} from "./room-mention-snooze";
import { tenantRoomsQueryOptions } from "./room-queries";
import { readRoomSnooze, roomSnoozedIds } from "./room-snooze";
import {
  AWAY_BEFORE_RETURN_MS,
  roomToOpenOnReturn,
  type RoomReturnFact,
} from "./return-to-arrived-room";

const OPEN_MODAL_SELECTOR = 'dialog[open], [role="dialog"][aria-modal="true"]';

/**
 * After this window has been hidden long enough, open the one room that moved.
 * A crowd stays listed by the recap. Writing, an open dialog, the setup gate,
 * and non-Room pages keep the person where they are.
 */
export function useReturnToArrivedRoom({
  accountId,
  activeRoomId,
  client,
  gated = false,
  onRoomRoute = Boolean(activeRoomId),
  queryClient,
  rooms,
  tenantId,
  navigate,
}: {
  accountId?: string;
  activeRoomId?: string;
  client: TeamHubClient;
  gated?: boolean;
  navigate: NavigateFunction;
  onRoomRoute?: boolean;
  queryClient: QueryClient;
  rooms: readonly TeamHubRoomListItem[] | undefined;
  tenantId: string;
}) {
  const hiddenAt = useRef<number | undefined>(undefined);
  const snapshot = useRef<RoomReturnFact[] | undefined>(undefined);
  const roomsRef = useRef(rooms);
  const activeRef = useRef(activeRoomId);
  const accountIdRef = useRef(accountId);
  const gatedRef = useRef(gated);
  const onRoomRouteRef = useRef(onRoomRoute);

  useEffect(() => {
    roomsRef.current = rooms;
    activeRef.current = activeRoomId;
    accountIdRef.current = accountId;
    gatedRef.current = gated;
    onRoomRouteRef.current = onRoomRoute;
  }, [accountId, activeRoomId, gated, onRoomRoute, rooms]);

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
      if (!onRoomRouteRef.current || gatedRef.current) return;
      const hiddenForMs = Date.now() - leftAt;
      if (hiddenForMs < AWAY_BEFORE_RETURN_MS) return;
      const active = activeRef.current;
      void (async () => {
        try {
          const fresh = await queryClient.fetchQuery(
            tenantRoomsQueryOptions(client, tenantId),
          );
          if (!onRoomRouteRef.current || gatedRef.current) return;
          const now = new Date(Date.now());
          const ignoredRoomIds = ignoredReturnRoomIds(
            accountIdRef.current,
            now,
          );
          const next = roomToOpenOnReturn({
            activeRoomId: active,
            after: roomReturnFacts(fresh.items),
            before,
            dialogOpen: document.querySelector(OPEN_MODAL_SELECTOR) !== null,
            hiddenForMs,
            ignoredRoomIds,
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

function ignoredReturnRoomIds(
  accountId: string | undefined,
  now: Date,
): ReadonlySet<string> {
  if (!accountId) return new Set();
  const snoozed = roomSnoozedIds(readRoomSnooze(accountId, now), now);
  const quiet = quietRoomIds(
    readRoomMentionSnooze(accountId, now),
    readRoomMentionMute(accountId),
    now,
  );
  return new Set([...snoozed, ...quiet]);
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
    current instanceof Element &&
    current.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ) !== null
  );
}
