import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { DayShapePage } from "./day-shape-page";

function meeting(id: string, path: string): TeamHubMemoryEntry {
  return {
    id,
    kind: "meeting",
    title: path.split("/").at(-1)!,
    path,
    content: "",
    summary: "",
    updated_at: "2026-10-01T08:00:00Z",
    meeting: {
      capture_id: `capture_${id}`,
      started_at: "2026-10-01T08:00:00Z",
      recording_document_id: "audio",
      recording_version_id: "audio_v1",
      recording_filename: "recording.m4a",
      transcript_document_id: "transcript",
      transcript_version_id: "transcript_v1",
      summary_ready: false,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 16));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage(search = "") {
  const runtime = createTestTeamHubRuntime();
  const entries = [
    meeting(
      "meeting_000000000000000000000001",
      "Meetings/2026/10/01/Meeting 09-05-00",
    ),
    meeting(
      "meeting_000000000000000000000002",
      "Meetings/2026/10/01/Meeting 17-41-02",
    ),
    meeting(
      "meeting_000000000000000000000003",
      "Meetings/2026/09/30/Meeting 11-00-00",
    ),
  ];
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
    items: query.get("kind") === "meeting" ? entries : [],
  }));
  const router = createMemoryRouter(
    [
      {
        element: <DayShapePage />,
        path: "/t/:tenantId/library/day-shape",
      },
    ],
    {
      initialEntries: [`/t/tenant-northstar/library/day-shape${search}`],
    },
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
  return router;
}

describe("DayShapePage", () => {
  it("draws today's open stretches and moves to the previous day", async () => {
    const router = renderPage();
    expect(
      await screen.findByText(
        "2 meetings. The longest open stretch is 8 hours 36 min, from 09:05 to 17:41.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Shape of Thu, Oct 1 · Today" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Meeting Oct 1, 09:05" }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/library/meetings?entry=meeting_000000000000000000000001",
    );
    expect(screen.queryByRole("link", { name: "Next day" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Previous day" }));
    expect(router.state.location.search).toBe("?date=2026-09-30");
    expect(
      await screen.findByRole("heading", { name: "Shape of Wed, Sep 30" }),
    ).toBeVisible();
    expect(
      screen.getByText("One meeting, at 11:00. The rest of the day is open."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Meeting Sep 30, 11:00" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Next day" }));
    expect(
      await screen.findByRole("heading", {
        name: "Shape of Thu, Oct 1 · Today",
      }),
    ).toBeVisible();
  });

  it("becomes the new day when midnight passes on today", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    vi.setSystemTime(new Date(2026, 9, 1, 23, 59, 50));
    const router = renderPage("?date=2026-10-01");
    expect(
      await screen.findByRole("heading", {
        name: "Shape of Thu, Oct 1 · Today",
      }),
    ).toBeVisible();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(
      await screen.findByRole("heading", {
        name: "Shape of Fri, Oct 2 · Today",
      }),
    ).toBeVisible();
    expect(router.state.location.search).toBe("?date=2026-10-02");
    expect(screen.getByText("The day is open.")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Meeting Oct 1, 09:05" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Next day" })).toBeNull();
  });

  it("leaves a past day in place when midnight passes", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    vi.setSystemTime(new Date(2026, 9, 1, 23, 59, 50));
    renderPage("?date=2026-09-30");
    expect(
      await screen.findByRole("heading", { name: "Shape of Wed, Sep 30" }),
    ).toBeVisible();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(
      screen.getByRole("heading", { name: "Shape of Wed, Sep 30" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Oct 2/u })).toBeNull();
  });
});
