import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { WhoIsAwakePage } from "./who-is-awake-page";

function availability(
  actorId: string,
  status: "online" | "offline",
  label: string,
) {
  return {
    actor_id: actorId,
    availability: { active_task_count: 0, label, status },
  };
}

describe("Who is awake", () => {
  it("puts the awake agent first and opens their chat", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/agent-availability",
      () => ({
        items: [
          availability("actor-lev8", "offline", "Offline"),
          availability("actor-codex", "online", "Online"),
          availability("actor-delegate", "offline", "Offline"),
        ],
        page: { has_more: false },
      }),
    );
    const router = createMemoryRouter(
      [
        { element: <WhoIsAwakePage />, path: "/t/:tenantId/awake" },
        {
          element: <p>Opened the chat</p>,
          path: "/t/:tenantId/rooms/:roomId/chat",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/awake"] },
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

    expect(await screen.findByText("1 is awake.")).toBeVisible();
    const names = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(names[0]).toContain("Codex");
    expect(names[0]).toContain("Online");
    expect(screen.getByRole("link", { name: "Talk to Codex" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms/room-dm-codex/chat",
    );
    expect(screen.getByText("Lev8 GTM")).toBeVisible();
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
  });
});
