import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { tenantRoomsQueryKey } from "../room-queries";
import { useOpenedUnreadCount } from "./new-messages-mark";

function room(unread: number): TeamHubRoomListItem {
  return {
    created_at: "2026-11-14T09:00:00Z",
    created_by: {
      display_name: "Ada",
      id: "actor-ada",
      kind: "human",
      tenant_id: "tenant-1",
    },
    id: "room-1",
    kind: "room",
    latest_room_seq: 4,
    name: "Room",
    read_through_room_seq: 1,
    tenant_id: "tenant-1",
    unread_mention_count: 0,
    unread_message_count: unread,
    updated_at: "2026-11-14T10:00:00Z",
  };
}

describe("opened unread count", () => {
  it("keeps the count from when the Room opened after the badge clears", async () => {
    const runtime = createTestTeamHubRuntime();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(tenantRoomsQueryKey("tenant-1"), {
      items: [room(2)],
      page: { has_more: false },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <TeamHubRuntimeProvider runtime={runtime}>
          {children}
        </TeamHubRuntimeProvider>
      </QueryClientProvider>
    );
    const view = renderHook(() => useOpenedUnreadCount("tenant-1", "room-1"), {
      wrapper,
    });
    await waitFor(() => expect(view.result.current).toBe(2));
    queryClient.setQueryData(tenantRoomsQueryKey("tenant-1"), {
      items: [room(0)],
      page: { has_more: false },
    });
    view.rerender();
    expect(view.result.current).toBe(2);
  });
});
