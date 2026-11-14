import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { LibraryWeekPage } from "./library-week-page";

function changed(
  template: TeamHubDocument,
  id: string,
  title: string,
  updatedAt: string,
): TeamHubDocument {
  return { ...template, id, title, updated_at: updatedAt };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LibraryWeekPage", () => {
  it("lists this week's files and leaves last month out", async () => {
    const runtime = createTestTeamHubRuntime();
    const template = (
      await teamHubData(
        runtime.client.api.GET("/v0/library/documents", {
          params: { query: { limit: 1, view: "recent" } },
        }),
      )
    ).items[0]!;
    runtime.server.on("GET", "/v0/library/documents", () => ({
      items: [
        changed(
          template,
          "document-brief",
          "Launch brief.md",
          "2026-11-12T16:00:00.000Z",
        ),
        changed(
          template,
          "document-notes",
          "Standup notes.md",
          "2026-11-12T09:00:00.000Z",
        ),
        changed(
          template,
          "document-old",
          "Old plan.md",
          "2026-10-01T09:00:00.000Z",
        ),
      ],
      page: { has_more: false },
    }));
    const router = createMemoryRouter(
      [
        { element: <LibraryWeekPage />, path: "/t/:tenantId/library/changed" },
        {
          element: <p>Opened the file</p>,
          path: "/t/:tenantId/documents/:documentId",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/library/changed"] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/2 files changed/)).toHaveTextContent(
      "2 files changed. Thu, Nov 12 held the most, with 2.",
    );
    const thursday = screen.getByRole("region", { name: "Thu, Nov 12" });
    expect(
      within(thursday).getByRole("link", { name: /Launch brief\.md/ }),
    ).toHaveAttribute("href", "/t/tenant-northstar/documents/document-brief");
    expect(screen.queryByRole("link", { name: /Old plan\.md/ })).toBeNull();
    expect(screen.queryByText(/more changes/)).toBeNull();
  });
});
