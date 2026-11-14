import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { SurpriseRoomPage } from "./surprise-room-page";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Surprise me", () => {
  it("spins and opens the room it lands on", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const runtime = createTestTeamHubRuntime();
    const router = createMemoryRouter(
      [
        { element: <SurpriseRoomPage />, path: "/t/:tenantId/surprise" },
        {
          element: <p>Opened the room</p>,
          path: "/t/:tenantId/rooms/:roomId/chat",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/surprise"] },
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

    fireEvent.click(await screen.findByRole("button", { name: "Spin" }));
    const landed = await screen.findByText(/It landed on /);
    const title = (landed.textContent ?? "")
      .replace("It landed on ", "")
      .replace(/\.$/, "");
    expect(
      screen.getByRole("link", { name: `Go to ${title}` }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/t\/tenant-northstar\/rooms\/[^/]+\/chat$/),
    );
  });
});
