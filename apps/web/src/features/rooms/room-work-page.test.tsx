import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubRunStatus,
  TeamHubRuntimePresentationEventRecord,
} from "@/features/teamhub/teamhub-types";

import { RoomWorkPage } from "./room-work-page";
import { RoomWatchLink } from "./room-watch-link";

function run(): TeamHubRunStatus {
  return {
    agent: { display_name: "Codex", id: "agent-1", kind: "agent" },
    created_at: "2026-11-14T02:00:00Z",
    id: "run-status-1",
    replied: false,
    revision: 1,
    room_id: "room-all",
    run_id: "run-status-1",
    status: "active",
    updated_at: "2026-11-14T02:00:01Z",
  };
}

function thinking(): TeamHubRuntimePresentationEventRecord {
  return {
    event: {
      status: "thinking",
      title: "Reading the brief",
      type: "status.changed",
    },
    event_ordinal: "1",
    segment_id: "segment-1",
  };
}

function renderWork() {
  const runtime = createTestTeamHubRuntime();
  runtime.seed.runStatusesByRoom.set("room-all", [run()]);
  runtime.seed.runtimePresentationEventsByRunStatusId.set("run-status-1", [
    thinking(),
  ]);
  const router = createMemoryRouter(
    [
      {
        element: <RoomWorkPage />,
        path: "/t/:tenantId/rooms/:roomId/working",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/rooms/room-all/working"] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

describe("RoomWorkPage", () => {
  it("shows the run that is still working and the step it has published", async () => {
    renderWork();
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Codex is working",
    });
    expect(heading).toBeVisible();
    expect(screen.queryByRole("main")).toBeNull();
    expect(await screen.findByText("Reading the brief")).toBeVisible();
    const back = screen.getByRole("link", { name: "Back to room" });
    expect(back).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms/room-all/chat",
    );
    expect(
      back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers Retry when room runs or work events fail to load", async () => {
    const runtime = createTestTeamHubRuntime();
    let failRuns = true;
    let failEvents = true;
    runtime.server.on("GET", "/v0/rooms/{roomId}/run-statuses", () => {
      if (failRuns) {
        failRuns = false;
        return teamHubErrorResponse(503, "RUN_STATUS_UNAVAILABLE");
      }
      return { items: [run()] };
    });
    runtime.server.on(
      "GET",
      "/v0/rooms/{roomId}/runs/{runId}/runtime-presentation-events",
      () => {
        if (failEvents) {
          failEvents = false;
          return teamHubErrorResponse(503, "EVENTS_UNAVAILABLE");
        }
        return {
          has_more: false,
          items: [thinking()],
          published_through_ordinal: "1",
        };
      },
    );
    const router = createMemoryRouter(
      [
        {
          element: <RoomWorkPage />,
          path: "/t/:tenantId/rooms/:roomId/working",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/working"] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This room could not be read.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("The work could not be loaded."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Reading the brief")).toBeVisible();
  });

  it("says when the room has no run", async () => {
    const runtime = createTestTeamHubRuntime();
    const router = createMemoryRouter(
      [
        {
          element: <RoomWorkPage />,
          path: "/t/:tenantId/rooms/:roomId/working",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-quiet/working"] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("Nothing is happening in this room."),
    ).toBeVisible();
  });
});

describe("RoomWatchLink", () => {
  it("appears only while this room is working", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", "/v0/tenants/{tenantId}/room-activity", () => ({
      failed_room_ids: [],
      running_room_ids: ["room-all"],
    }));
    const router = createMemoryRouter(
      [
        {
          element: (
            <RoomWatchLink roomId="room-all" tenantId="tenant-northstar" />
          ),
          path: "/t/:tenantId/rooms/:roomId/chat",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/chat"] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("link", { name: "Watch the work" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/rooms/room-all/working");
  });
});
