import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

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
    expect(screen.getByRole("button", { name: "Spin again" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to chats" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms",
    );
  });

  it("lands immediately under reduced motion and offers Retry on error", async () => {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...matchMedia(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const runtime = createTestTeamHubRuntime();
    const seeded = createTestTeamHubRuntime(runtime.seed);
    let fail = true;
    runtime.server.on("GET", "/v0/tenants/{tenantId}/rooms", ({ request }) =>
      fail
        ? teamHubErrorResponse(503, "UNAVAILABLE", "Unavailable")
        : seeded.server.fetch(request),
    );
    const router = createMemoryRouter(
      [{ element: <SurpriseRoomPage />, path: "/t/:tenantId/surprise" }],
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The rooms could not be gathered.",
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(await screen.findByRole("button", { name: "Spin" }));
    expect(screen.getByText(/It landed on /)).toBeVisible();
  });
});
