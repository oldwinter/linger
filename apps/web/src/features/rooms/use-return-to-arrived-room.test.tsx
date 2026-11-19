import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { useCallback, type ReactNode } from "react";
import type { NavigateFunction } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { muteRoomMention } from "./room-mention-snooze";
import { tenantRoomsQueryKey } from "./room-queries";
import { setRoomSnooze } from "./room-snooze";
import { useReturnToArrivedRoom } from "./use-return-to-arrived-room";

function room(id: string, seq: number): TeamHubRoomListItem {
  return {
    id,
    kind: "room",
    latest_room_seq: seq,
  } as unknown as TeamHubRoomListItem;
}

const client = {} as unknown as TeamHubClient;

function Harness({
  accountId,
  activeRoomId = "here",
  gated = false,
  navigate,
  onRoomRoute = true,
  queryClient,
  rooms,
}: {
  accountId?: string;
  activeRoomId?: string;
  gated?: boolean;
  navigate: (path: string) => void;
  onRoomRoute?: boolean;
  queryClient: QueryClient;
  rooms: TeamHubRoomListItem[];
}) {
  const go = useCallback<NavigateFunction>(
    (path) => {
      if (typeof path === "string") navigate(path);
    },
    [navigate],
  );
  useReturnToArrivedRoom({
    accountId,
    activeRoomId,
    client,
    gated,
    navigate: go,
    onRoomRoute,
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
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("opens the room that moved after the window was hidden", async () => {
    defineGlobalProperty(document, "hidden", {
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

  it("never navigates away from non-Room routes, under the setup gate, with an ARIA modal, while writing in nested contenteditable, or for snoozed/muted rooms", async () => {
    defineGlobalProperty(document, "hidden", {
      get: () => hidden.value,
    });
    const started = 1_700_000_000_000;
    const rooms = [room("here", 1), room("design", 4)];

    async function runScenario(
      props: Partial<Parameters<typeof Harness>[0]>,
      setup?: () => () => void,
    ) {
      vi.spyOn(Date, "now").mockReturnValue(started);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      queryClient.setQueryData(tenantRoomsQueryKey("tenant-northstar"), {
        items: rooms,
      });
      const navigate = vi.fn();
      const teardown = setup?.();
      const view = render(
        <QueryClientProvider client={queryClient}>
          <Harness
            navigate={navigate}
            queryClient={queryClient}
            rooms={rooms}
            {...props}
          />
        </QueryClientProvider>,
      );
      try {
        hidden.value = true;
        document.dispatchEvent(new Event("visibilitychange"));
        vi.spyOn(Date, "now").mockReturnValue(started + 60_000);
        queryClient.setQueryData(tenantRoomsQueryKey("tenant-northstar"), {
          items: [room("here", 1), room("design", 5)],
        });
        hidden.value = false;
        document.dispatchEvent(new Event("visibilitychange"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(navigate).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        teardown?.();
      }
    }

    // Non-Room route (Dashboard, Library, Settings, etc.)
    await runScenario({ activeRoomId: undefined, onRoomRoute: false });
    // Setup gate active
    await runScenario({ gated: true });
    // ARIA modal dialog open
    await runScenario({}, () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      document.body.append(dialog);
      return () => dialog.remove();
    });
    // Nested contenteditable descendant focused
    await runScenario({}, () => {
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      const child = document.createElement("span");
      child.tabIndex = 0;
      editor.append(child);
      document.body.append(editor);
      child.focus();
      return () => editor.remove();
    });
    // Snoozed room
    setRoomSnooze(
      "account-jenny",
      "design",
      new Date(started + 3_600_000),
      new Date(started),
    );
    await runScenario({ accountId: "account-jenny" });
    window.localStorage.clear();
    // Muted room
    muteRoomMention("account-jenny", "design", new Date(started));
    await runScenario({ accountId: "account-jenny" });
  });
});
