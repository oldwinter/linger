import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { WorkMovesPage } from "./work-moves-page";

function renderPage(roomId: string) {
  const runtime = createTestTeamHubRuntime();
  const router = createMemoryRouter(
    [
      {
        element: <WorkMovesPage />,
        path: "/t/:tenantId/rooms/:roomId/how-work-moves",
      },
    ],
    {
      initialEntries: [`/t/tenant-northstar/rooms/${roomId}/how-work-moves`],
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
}

describe("WorkMovesPage", () => {
  it("shows the published path for the room", async () => {
    renderPage("room-all");
    expect(
      await screen.findByRole("heading", { name: "Cross verification" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "One person prepares the work. Another checks it and sends the findings back.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Codex starts the work.")).toBeVisible();
    expect(screen.getByText("Codex hands the work to Lev8 GTM.")).toBeVisible();
    expect(screen.getByText("Lev8 GTM reports back to Codex.")).toBeVisible();
    expect(
      screen.getByText(
        "Review the launch plan against implementation evidence.",
      ),
    ).toBeVisible();
  });

  it("says when the room has no collaboration plan", async () => {
    renderPage("room-quiet");
    expect(
      await screen.findByText(
        "No collaboration plan yet. When an agent publishes one, the path shows up here.",
      ),
    ).toBeVisible();
  });
});
