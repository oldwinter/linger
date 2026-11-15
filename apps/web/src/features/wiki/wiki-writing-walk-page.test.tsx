import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { WikiCollectionPage } from "./wiki-collection-page";
import { serveWikiStatus } from "./wiki.test-support";

const atlas = `---\n${JSON.stringify({ type: "Project", title: "Project Atlas", description: "Delivery analytics migration" })}\n---\n\n# Project Atlas\n\nBudget USD 210,000.\n`;
const tom = `---\n${JSON.stringify({ type: "Contact", title: "Tom Becker", description: "Northwind sponsor" })}\n---\n\n# Tom Becker\n\nSponsors the rollout.\n`;

function renderWalk(refreshing: boolean) {
  const runtime = createTestTeamHubRuntime();
  serveWikiStatus(runtime).mockResolvedValue({
    created_at: "2026-08-23T00:00:00.000Z",
    id: "wiki-tenant-northstar",
    latest_refresh_id: "refresh-1",
    owner_actor_id: "actor-human",
    preview_revision: refreshing ? 1 : undefined,
    published_generation: 1,
    state: refreshing ? "refreshing" : "idle",
    tenant_id: "tenant-northstar",
    updated_at: "2026-08-23T00:00:00.000Z",
  });
  if (refreshing) {
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/personal-wiki/preview",
      () => ({
        "contacts/tom.md": tom,
        "projects/atlas.md": atlas,
      }),
    );
  }
  const router = createMemoryRouter(
    [
      {
        element: <WikiCollectionPage />,
        path: "/t/:tenantId/library/wiki/:collection",
      },
      {
        element: <div>Preview</div>,
        path: "/t/:tenantId/wiki-preview",
      },
    ],
    {
      initialEntries: ["/t/tenant-northstar/library/wiki/writing"],
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

describe("Wiki writing walk", () => {
  it("reads the pages written so far and opens one", async () => {
    const router = renderWalk(true);
    expect(
      await screen.findByRole("heading", { name: "Project Atlas" }),
    ).toBeVisible();
    expect(screen.getByText("1 of 2 · Projects")).toBeVisible();
    expect(screen.getByText("Delivery analytics migration")).toBeVisible();
    expect(screen.getByText("Budget USD 210,000.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/wiki-preview?page=projects%2Fatlas.md",
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Tom Becker" })).toBeVisible();
    expect(screen.getByText("Sponsors the rollout.")).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "Open page" }));
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/wiki-preview",
    );
    expect(router.state.location.search).toBe("?page=contacts%2Ftom.md");
  });

  it("says when Another Me is not writing", async () => {
    renderWalk(false);
    expect(
      await screen.findByText("Another Me is not writing the Wiki right now."),
    ).toBeVisible();
  });
});
