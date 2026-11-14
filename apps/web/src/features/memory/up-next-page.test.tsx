import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { UpNextPage } from "./up-next-page";

function meeting(id: string, path: string): TeamHubMemoryEntry {
  return {
    content: "",
    id,
    kind: "meeting",
    meeting: {
      capture_id: id,
      recording_document_id: "audio",
      recording_filename: "room.m4a",
      recording_version_id: "v1",
      started_at: "2026-10-01T09:00:00Z",
      summary_ready: false,
      transcript_document_id: "transcript",
      transcript_version_id: "v1",
    },
    path,
    summary: "",
    title: path,
    updated_at: "2026-10-01T09:00:00Z",
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 16, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Up next", () => {
  it("counts down to the closest meeting and opens it", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
      items:
        query.get("kind") === "meeting"
          ? [
              meeting("morning", "Meetings/2026/10/01/Meeting 09-05-00"),
              meeting("afternoon", "Meetings/2026/10/01/Meeting 17-41-02"),
            ]
          : [],
    }));
    const router = createMemoryRouter(
      [
        { element: <UpNextPage />, path: "/t/:tenantId/library/up-next" },
        {
          element: <p>Opened the meeting</p>,
          path: "/t/:tenantId/library/meetings",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/library/up-next"] },
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

    expect(await screen.findByText("01:41:02")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "It starts in 1 hour 42 minutes.",
    );
    expect(
      screen.getByRole("link", { name: "Open this meeting" }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/library/meetings?entry=afternoon",
    );
  });
});
