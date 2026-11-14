import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { TeamHubRoomPage } from "@/features/teamhub/teamhub-types";

import { tenantRoomsQueryKey } from "../room-queries";
import { useRoomReadBoundary } from "./use-room-read-boundary";

describe("Room read boundary capture", () => {
  it("keeps the boundary the Room opened with when read state advances", () => {
    const queryClient = new QueryClient();
    const queryKey = tenantRoomsQueryKey("tenant-1");
    queryClient.setQueryData(queryKey, rooms(7));
    const { result } = renderHook(
      () => useRoomReadBoundary("tenant-1", "room-1"),
      { wrapper: wrapper(queryClient) },
    );
    expect(result.current).toEqual({ readThroughRoomSeq: 7 });
    act(() => {
      queryClient.setQueryData(queryKey, rooms(20));
    });
    expect(result.current).toEqual({ readThroughRoomSeq: 7 });
  });

  it("leaves no boundary when the Room list has no row", () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () => useRoomReadBoundary("tenant-1", "room-1"),
      { wrapper: wrapper(queryClient) },
    );
    expect(result.current).toBeUndefined();
  });
});

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function rooms(readThroughRoomSeq: number): TeamHubRoomPage {
  return {
    items: [
      {
        created_at: "2026-10-22T10:00:00Z",
        created_by: {
          display_name: "Alice",
          id: "human-1",
          kind: "human",
          tenant_id: "tenant-1",
        },
        id: "room-1",
        kind: "room",
        latest_room_seq: 20,
        name: "Launch",
        read_through_room_seq: readThroughRoomSeq,
        tenant_id: "tenant-1",
        unread_mention_count: 0,
        unread_message_count: 1,
        updated_at: "2026-10-22T10:00:00Z",
      },
    ],
    page: { has_more: false },
  };
}
