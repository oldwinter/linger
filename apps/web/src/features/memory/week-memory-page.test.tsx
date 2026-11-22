import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { WeekMemoryPage } from "./week-memory-page";

function meeting(id: string, path: string): TeamHubMemoryEntry {
  return {
    content: "",
    id,
    kind: "meeting",
    meeting: {
      capture_id: `capture_${id}`,
      recording_document_id: "audio",
      recording_filename: "recording.m4a",
      recording_version_id: "audio_v1",
      started_at: "2026-11-12T01:00:00Z",
      summary_ready: false,
      transcript_document_id: "transcript",
      transcript_version_id: "transcript_v1",
    },
    path,
    summary: "",
    title: path.split("/").at(-1)!,
    updated_at: "2026-11-12T01:00:00Z",
  };
}

function daily(date: string): TeamHubMemoryEntry {
  return {
    content: "",
    date,
    id: `daily_${date}`,
    kind: "daily",
    path: `daily/${date}.md`,
    summary: "",
    title: `Daily ${date}`,
    updated_at: `${date}T00:00:00Z`,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WeekMemoryPage", () => {
  it("reads the whole week of meetings, dailies, and notes", async () => {
    const runtime = createTestTeamHubRuntime();
    const meetings = [
      meeting(
        "meeting_000000000000000000000001",
        "Meetings/2026/11/12/Meeting 09-00-00",
      ),
      meeting(
        "meeting_000000000000000000000002",
        "Meetings/2026/11/12/Meeting 15-00-00",
      ),
      meeting(
        "meeting_000000000000000000000003",
        "Meetings/2026/11/14/Meeting 10-00-00",
      ),
    ];
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => {
      const kind = query.get("kind");
      if (kind === "meeting") return { items: meetings };
      if (kind === "daily") return { items: [daily("2026-11-12")] };
      return { items: [] };
    });
    runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () => ({
      items: [
        {
          date: "2026-11-10",
          text: "A note",
          updated_at: "2026-11-10T01:00:00Z",
        },
      ],
      page: { has_more: false },
      today: "2026-11-14",
    }));
    const router = createMemoryRouter(
      [
        {
          element: <WeekMemoryPage />,
          path: "/t/:tenantId/library/week",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/library/week"] },
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
      await screen.findByText(
        "You met 3 times. Thu, Nov 12 was the fullest, with 2 meetings. A daily was written on 1 day. You kept a note on 1 day.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "What changed this week" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/library/changed");
    expect(
      screen.getByRole("link", { name: "Thu, Nov 12 · 2 meetings · a daily" }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/library/day?date=2026-11-12",
    );
    expect(
      screen.getByRole("link", { name: "Tue, Nov 10 · a note" }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/library/day?date=2026-11-10",
    );
  });
});
