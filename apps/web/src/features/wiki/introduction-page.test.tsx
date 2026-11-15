import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import type { TestRouteHandler } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { IntroductionPage } from "./introduction-page";

function renderPage() {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () => ({
    items: [
      {
        date: "2026-11-14",
        text: "Buy milk",
        updated_at: "2026-11-14T01:00:00Z",
      },
    ],
    page: { has_more: false },
    today: "2026-11-14",
  }));
  const save = vi.fn<TestRouteHandler>(({ body }) => ({
    date: "2026-11-14",
    text: (body as { text: string }).text,
    updated_at: "2026-11-14T02:00:00Z",
  }));
  runtime.server.on(
    "PUT",
    "/v0/tenants/{tenantId}/me/pocket-notes/today",
    save,
  );
  const router = createMemoryRouter(
    [
      {
        element: <IntroductionPage />,
        path: "/t/:tenantId/library/introduction",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/library/introduction"] },
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
  return save;
}

describe("IntroductionPage", () => {
  it("reorders the card and leaves it on today's note", async () => {
    const save = renderPage();
    expect(await screen.findByText("This is Jenny Bin.")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Lead with how you work" }),
    );
    const card = screen.getByRole("article", { name: "Introduction" });
    expect(card.textContent?.startsWith("Jenny Bin works like this:")).toBe(
      true,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Leave this on today's note" }),
    );
    expect(await screen.findByText("It is on today's note.")).toBeVisible();
    const body = save.mock.calls[0]?.[0]?.body as { text: string };
    expect(body.text.startsWith("Buy milk\n\n")).toBe(true);
    expect(body.text).toContain(
      "Jenny Bin works like this: Keeps execution close to customer outcomes.",
    );
  });
});
