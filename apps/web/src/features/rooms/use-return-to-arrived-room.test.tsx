import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { tenantRoomsQueryKey } from "./room-queries";
import { useReturnToArrivedRoom } from "./use-return-to-arrived-room";

function room(id: string, seq: number): TeamHubRoomListItem {
  return {
    id,
    kind: "collaboration",
    latest_room_seq: seq,
  } as TeamHubRoomListItem;
}

function Harness({
  navigate,
  queryClient,
  rooms,
}: {
  navigate: (path: string) => void;
  queryClient: QueryClient;
  rooms: TeamHubRoomListItem[];
}) {
  useReturnToArrivedRoom({
    activeRoomId: "here",
    client: {} as TeamHubClient,
    navigate: (path) => {
      if (typeof path === "string") navigate(path);
    },
    queryClient,
    rooms,
    tenantId: "tenant-northstar",
  });
  return null;
}

describe("useReturnToArrivedRoom", () => {
  const hidden = { value: false };

  afterEach(() => {
    hidden.value = false;
    vi.restoreAllMocks();
  });

  it("opens the room that moved after the window was hidden", async () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden.value,
    });
    const started = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(started);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rooms = [room("here", 1), room("design", 4)];
    queryClient.setQueryData(tenantRoomsQueryKey("tenant-northstar"), {
      items: rooms,
    });
    const navigate = vi.fn();
    function renderHarness(children: ReactNode) {
      return render(
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>,
      );
    }
    renderHarness(
      <Harness navigate={navigate} queryClient={queryClient} rooms={rooms} />,
    );

    hidden.value = true;
    document.dispatchEvent(new Event("visibilitychange"));
    vi.spyOn(Date, "now").mockReturnValue(started + 60_000);
    queryClient.setQueryData(tenantRoomsQueryKey("tenant-northstar"), {
      items: [room("here", 1), room("design", 5)],
    });
    hidden.value = false;
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        "/t/tenant-northstar/rooms/design/chat",
      );
    });
  });
});
