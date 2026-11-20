import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubRunStatus,
  TeamHubRuntimePresentationEventRecord,
} from "@/features/teamhub/teamhub-types";

import { SteerRunPage } from "./steer-run-page";

function run(): TeamHubRunStatus {
  return {
    agent: { display_name: "Codex", id: "agent-1", kind: "agent" },
    created_at: "2026-11-14T02:00:00Z",
    id: "run-status-steer",
    replied: false,
    revision: 1,
    room_id: "room-quiet",
    run_id: "run-steer",
    status: "active",
    updated_at: "2026-11-14T02:00:01Z",
  };
}

function plan(): TeamHubRuntimePresentationEventRecord {
  return {
    event: {
      steps: [
        { content: "Check the release", status: "completed" },
        { content: "Write the notes", status: "in_progress" },
        { content: "Send them", status: "pending" },
      ],
      type: "plan.updated",
    },
    event_ordinal: "1",
    segment_id: "segment-1",
  };
}

describe("SteerRunPage", () => {
  it("shows the step in progress and stops the run before the next one", async () => {
    const runtime = createTestTeamHubRuntime();
    const status = run();
    runtime.seed.runStatusesByRoom.set("room-quiet", [status]);
    runtime.seed.runtimePresentationEventsByRunStatusId.set(status.id, [
      plan(),
    ]);
    const cancel = vi.fn<TestRouteHandler>(({ body, params }) => {
      expect(params.runId).toBe("run-steer");
      expect(body).toEqual(
        expect.objectContaining({ request_id: expect.any(String) }),
      );
      return {
        agent_actor_id: "agent-1",
        message_ids: [],
        run_id: "run-steer",
        status: "cancel_requested",
      };
    });
    runtime.server.on("POST", "/v0/rooms/{roomId}/runs/{runId}/cancel", cancel);
    const router = createMemoryRouter(
      [
        {
          element: <SteerRunPage />,
          path: "/t/:tenantId/rooms/:roomId/steer",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-quiet/steer"] },
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
    expect(await screen.findByText("Doing this now")).toBeVisible();
    expect(screen.getByText("Write the notes")).toBeVisible();
    expect(screen.getByText("Still ahead")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Stop before the next step" }),
    );
    expect(
      await screen.findByText(
        "Stop requested. The agent will not take the next step.",
      ),
    ).toBeVisible();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("shows an error alert with Retry when run status fails to load", async () => {
    const runtime = createTestTeamHubRuntime();
    let fail = true;
    runtime.server.on("GET", "/v0/rooms/{roomId}/run-statuses", () => {
      if (fail) {
        fail = false;
        return teamHubErrorResponse(503, "RUN_STATUS_UNAVAILABLE");
      }
      return { items: [run()] };
    });
    const router = createMemoryRouter(
      [
        {
          element: <SteerRunPage />,
          path: "/t/:tenantId/rooms/:roomId/steer",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-quiet/steer"] },
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Run status could not be loaded.");
    expect(
      screen.queryByText("Nothing is running in this room."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Codex is working")).toBeVisible();
  });

  it("resets stop state and uses a new request_id when a new run starts", async () => {
    const runtime = createTestTeamHubRuntime();
    const firstRun = run();
    const secondRun: TeamHubRunStatus = {
      ...firstRun,
      id: "run-status-steer-2",
      run_id: "run-steer-2",
    };
    let activeRun = firstRun;
    runtime.server.on("GET", "/v0/rooms/{roomId}/run-statuses", () => ({
      items: [activeRun],
    }));
    const requestIds: string[] = [];
    runtime.server.on(
      "POST",
      "/v0/rooms/{roomId}/runs/{runId}/cancel",
      ({ body, params }) => {
        requestIds.push((body as { request_id: string }).request_id);
        return {
          agent_actor_id: "agent-1",
          message_ids: [],
          run_id: params.runId!,
          status: "cancel_requested",
        };
      },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          element: <SteerRunPage />,
          path: "/t/:tenantId/rooms/:roomId/steer",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-quiet/steer"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Stop before the next step" }),
    );
    expect(
      await screen.findByText(
        "Stop requested. The agent will not take the next step.",
      ),
    ).toBeVisible();

    activeRun = secondRun;
    await queryClient.invalidateQueries();
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop before the next step" }),
    );
    expect(
      await screen.findByText(
        "Stop requested. The agent will not take the next step.",
      ),
    ).toBeVisible();
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).not.toBe(requestIds[1]);
  });

  it("renders inside a semantic section with Back to room at the top and lets users switch among concurrent runs", async () => {
    const runtime = createTestTeamHubRuntime();
    const codexRun = run();
    const reviewerRun: TeamHubRunStatus = {
      ...codexRun,
      agent: { display_name: "Reviewer", id: "agent-reviewer", kind: "agent" },
      id: "run-status-reviewer",
      run_id: "run-reviewer",
    };
    runtime.seed.runStatusesByRoom.set("room-quiet", [codexRun, reviewerRun]);
    runtime.seed.runtimePresentationEventsByRunStatusId.set(codexRun.id, [
      plan(),
    ]);
    runtime.seed.runtimePresentationEventsByRunStatusId.set(reviewerRun.id, [
      {
        event: {
          steps: [{ content: "Audit permissions", status: "in_progress" }],
          type: "plan.updated",
        },
        event_ordinal: "1",
        segment_id: "segment-1",
      },
    ]);
    const cancel = vi.fn<TestRouteHandler>(({ params }) => ({
      agent_actor_id: "agent-reviewer",
      message_ids: [],
      run_id: params.runId!,
      status: "cancel_requested",
    }));
    runtime.server.on("POST", "/v0/rooms/{roomId}/runs/{runId}/cancel", cancel);
    const router = createMemoryRouter(
      [
        {
          element: <SteerRunPage />,
          path: "/t/:tenantId/rooms/:roomId/steer",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-quiet/steer"] },
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

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Steer this run",
    });
    expect(screen.queryByRole("main")).toBeNull();
    const back = screen.getByRole("link", { name: "Back to room" });
    expect(
      back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(await screen.findByText("Write the notes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reviewer" }));
    expect(await screen.findByText("Audit permissions")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Reviewer is working" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Stop before the next step" }),
    );
    expect(
      await screen.findByText(
        "Stop requested. The agent will not take the next step.",
      ),
    ).toBeVisible();
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ runId: "run-reviewer" }),
      }),
    );

    // Switching back to Codex keeps Codex steerable independently.
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(
      await screen.findByRole("button", { name: "Stop before the next step" }),
    ).toBeEnabled();
  });

  it("offers Retry when loading a run's plan fails", async () => {
    const runtime = createTestTeamHubRuntime();
    const status = run();
    runtime.seed.runStatusesByRoom.set("room-quiet", [status]);
    let fail = true;
    runtime.server.on(
      "GET",
      "/v0/rooms/{roomId}/runs/{runId}/runtime-presentation-events",
      () => {
        if (fail) {
          fail = false;
          return teamHubErrorResponse(503, "PLAN_UNAVAILABLE");
        }
        return {
          has_more: false,
          items: [plan()],
          published_through_ordinal: "1",
        };
      },
    );
    const router = createMemoryRouter(
      [
        {
          element: <SteerRunPage />,
          path: "/t/:tenantId/rooms/:roomId/steer",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-quiet/steer"] },
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
      "The plan could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Write the notes")).toBeVisible();
  });
});
