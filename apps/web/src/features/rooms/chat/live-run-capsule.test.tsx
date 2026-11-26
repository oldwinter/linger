import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import type {
  TeamHubRunStatus,
  TeamHubRuntimePresentationEventRecord,
} from "@/features/teamhub/teamhub-types";

import { LiveRunCapsule, formatElapsedDuration } from "./live-run-capsule";

function makeRun(overrides: Partial<TeamHubRunStatus> = {}): TeamHubRunStatus {
  return {
    agent: { display_name: "Codex", id: "agent-codex", kind: "agent" },
    created_at: new Date(Date.now() - 42_000).toISOString(),
    id: "run-status-1",
    replied: false,
    revision: 1,
    room_id: "room-live",
    run_id: "run-1",
    status: "active",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makePlanEvent(): TeamHubRuntimePresentationEventRecord {
  return {
    event: {
      steps: [
        { content: "Inspect codebase", status: "completed" },
        { content: "Implement steer bar", status: "in_progress" },
        { content: "Run verification", status: "pending" },
      ],
      type: "plan.updated",
    },
    event_ordinal: "1",
    segment_id: "seg-1",
  };
}

function renderCapsule(props: Parameters<typeof LiveRunCapsule>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LiveRunCapsule {...props} />
    </QueryClientProvider>,
  );
}

describe("LiveRunCapsule", () => {
  it("formats elapsed durations cleanly across seconds, minutes, and hours", () => {
    const start = "2026-11-26T10:00:00Z";
    const startMs = Date.parse(start);
    expect(formatElapsedDuration(start, startMs + 15_000)).toBe("15s");
    expect(formatElapsedDuration(start, startMs + 95_000)).toBe("1m 35s");
    expect(formatElapsedDuration(start, startMs + 3_720_000)).toBe("1h 2m");
    expect(formatElapsedDuration("invalid", startMs)).toBe("0s");
  });

  it("renders nothing when no runs are working", () => {
    const runtime = createTestTeamHubRuntime();
    const { container } = renderCapsule({
      client: runtime.client,
      onOpenActivity: vi.fn(),
      onSendSteer: vi.fn(),
      roomId: "room-live",
      tenantId: "tenant-northstar",
      workingRuns: [],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows active step summary, expands checklist, sends steer follow-up, opens activity, and stops run", async () => {
    const runtime = createTestTeamHubRuntime();
    const run = makeRun();
    const planEvent = makePlanEvent();
    const cancel = vi.fn<TestRouteHandler>(({ body, params }) => {
      expect(params.runId).toBe("run-1");
      expect(body).toEqual(
        expect.objectContaining({ request_id: expect.any(String) }),
      );
      return {
        agent_actor_id: "agent-codex",
        message_ids: [],
        run_id: "run-1",
        status: "cancel_requested",
      };
    });
    runtime.server.on("POST", "/v0/rooms/{roomId}/runs/{runId}/cancel", cancel);

    const onOpenActivity = vi.fn();
    const onSendSteer = vi.fn().mockResolvedValue(undefined);

    renderCapsule({
      client: runtime.client,
      onOpenActivity,
      onSendSteer,
      roomId: "room-live",
      roomKind: "room",
      runtimePresentationEventsByRunStatusId: { [run.id]: [planEvent] },
      tenantId: "tenant-northstar",
      workingRuns: [run],
    });

    expect(screen.getByTestId("live-run-capsule")).toBeVisible();
    expect(screen.getByText("Codex is working")).toBeVisible();
    expect(screen.getByText("Implement steer bar")).toBeVisible();
    expect(screen.getByText("1/3")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand live run details" }),
    );

    expect(screen.getByRole("list", { name: "Run plan" })).toBeVisible();
    expect(screen.getByText("Inspect codebase")).toBeVisible();
    expect(screen.getByText("Run verification")).toBeVisible();

    // Send a steer follow-up
    const input = screen.getByRole("textbox", {
      name: "Steer or follow up with Codex",
    });
    fireEvent.change(input, { target: { value: "Focus on tests first" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    expect(await screen.findByText("Follow-up sent to Codex.")).toBeVisible();
    expect(onSendSteer).toHaveBeenCalledWith({
      body: "@Codex Focus on tests first",
      files: [],
      mentions: [
        {
          display_name: "Codex",
          id: "agent-codex",
          kind: "agent",
          tenant_id: "tenant-northstar",
        },
      ],
    });
    expect(input).toHaveValue("");

    // Open activity in-place
    fireEvent.click(screen.getByRole("button", { name: "Open activity" }));
    expect(onOpenActivity).toHaveBeenCalledWith(run);

    // Stop run
    const stopButton = screen.getByRole("button", {
      name: "Stop Codex's run",
    });
    expect(stopButton).toHaveAttribute("data-voice-risk", "confirm");
    fireEvent.click(stopButton);
    expect(
      await screen.findByText(
        "Stop requested. The agent will not take the next step.",
      ),
    ).toBeVisible();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("shows error feedback when stop fails and supports switching concurrent runs", async () => {
    const runtime = createTestTeamHubRuntime();
    const codex = makeRun();
    const reviewer = makeRun({
      agent: { display_name: "Reviewer", id: "agent-rev", kind: "agent" },
      id: "run-status-2",
      run_id: "run-2",
    });
    runtime.server.on("POST", "/v0/rooms/{roomId}/runs/{runId}/cancel", () =>
      teamHubErrorResponse(503, "CANCEL_UNAVAILABLE"),
    );

    renderCapsule({
      client: runtime.client,
      onOpenActivity: vi.fn(),
      onSendSteer: vi.fn(),
      roomId: "room-live",
      roomKind: "direct",
      runtimePresentationEventsByRunStatusId: {
        [codex.id]: [makePlanEvent()],
        [reviewer.id]: [
          {
            event: {
              activity_id: "act-1",
              kind: "search",
              title: "Searching docs",
              type: "activity.started",
            },
            event_ordinal: "1",
            segment_id: "seg-r",
          },
        ],
      },
      tenantId: "tenant-northstar",
      workingRuns: [codex, reviewer],
    });

    expect(screen.getByText("+1 more")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand live run details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reviewer" }));
    expect(screen.getByText("Reviewer is working")).toBeVisible();
    expect(screen.getAllByText("Searching docs").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Stop Reviewer's run" }),
      );
    });
    expect(await screen.findByRole("alert")).toBeVisible();
  });
});
