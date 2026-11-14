import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { DayReviewPage } from "./day-review-page";

function meeting(): TeamHubMemoryEntry {
  return {
    content: "",
    id: "meeting-1",
    kind: "meeting",
    meeting: {
      capture_id: "capture_1",
      recording_document_id: "audio",
      recording_filename: "stand-up.m4a",
      recording_version_id: "audio_v1",
      started_at: "2026-11-14T09:05:00Z",
      summary_ready: true,
      transcript_document_id: "transcript",
      transcript_version_id: "transcript_v1",
    },
    path: "Meetings/2026/11/14/Meeting 09-05-00",
    summary: "",
    title: "Meeting 09-05-00",
    updated_at: "2026-11-14T09:05:00Z",
  };
}

function daily(day: string, summary: string): TeamHubMemoryEntry {
  return {
    content: "",
    date: day,
    id: `daily-${day}`,
    kind: "daily",
    path: `timeline/daily/${day}.md`,
    summary,
    title: `Daily ${day}`,
    updated_at: `${day}T00:00:00Z`,
  };
}

describe("This day", () => {
  it("walks Pocket, meetings, and the Daily, then saves today's note", async () => {
    const runtime = createTestTeamHubRuntime();
    const notes = [
      {
        date: "2026-11-14",
        text: "Buy milk",
        updated_at: "2026-11-14T08:00:00Z",
      },
      {
        date: "2026-11-13",
        text: "Call Mom",
        updated_at: "2026-11-13T08:00:00Z",
      },
    ];
    runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () => ({
      items: notes,
      page: { has_more: false },
      today: "2026-11-14",
    }));
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => {
      if (query.get("kind") === "meeting") return { items: [meeting()] };
      if (query.get("kind") === "daily")
        return { items: [daily("2026-11-14", "Shipped the brief.")] };
      return { items: [] };
    });
    runtime.server.on(
      "PUT",
      "/v0/tenants/{tenantId}/me/pocket-notes/today",
      ({ body }) => ({
        date: "2026-11-14",
        text: (body as { text: string }).text,
        updated_at: "2026-11-14T12:00:00Z",
      }),
    );
    const router = createMemoryRouter(
      [
        {
          element: <DayReviewPage />,
          path: "/t/:tenantId/library/day",
        },
        {
          element: <div>Meeting</div>,
          path: "/t/:tenantId/library/meetings",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/library/day"] },
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
      await screen.findByRole("heading", {
        name: "Saturday, November 14, 2026",
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Today's Pocket Note")).toHaveValue(
      "Buy milk",
    );
    expect(
      screen.getByRole("link", { name: "Meeting Nov 14, 09:05" }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/library/meetings?entry=meeting-1",
    );
    expect(screen.getByText("Shipped the brief.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Next day" })).toBeNull();
    expect(screen.getByText("Next day")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Previous day" }));
    expect(
      await screen.findByRole("heading", { name: "Friday, November 13, 2026" }),
    ).toBeTruthy();
    expect(await screen.findByText("Call Mom")).toBeTruthy();
    expect(screen.getByText("No meetings.")).toBeTruthy();
    expect(
      screen.getByText("Another Me has not written this day."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Next day" }));
    expect(
      await screen.findByRole("heading", {
        name: "Saturday, November 14, 2026",
      }),
    ).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("Today's Pocket Note"), {
      target: { value: "Buy milk and orchids" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save to Pocket" }));
    await waitFor(() =>
      expect(
        runtime.server.requestsTo(
          "PUT",
          "/v0/tenants/{tenantId}/me/pocket-notes/today",
        ),
      ).toHaveLength(1),
    );
    expect(
      await screen.findByText("Saved. Another Me reads this into memory."),
    ).toBeTruthy();
  });
});
