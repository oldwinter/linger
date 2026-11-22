import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { seedProfile } from "@/test/teamhub-seed";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubPersonalProfileRevision } from "@/features/teamhub/teamhub-types";

import { RememberedPage } from "./remembered-page";

function revision(
  id: string,
  profile: TeamHubPersonalProfileRevision["profile"],
): TeamHubPersonalProfileRevision {
  return {
    created_at: "2026-08-11T08:00:00.000Z",
    id,
    markdown: "",
    profile,
    prompt_version: "user-profile-v1",
    tenant_id: "tenant-northstar",
  };
}

function renderPage(
  history: TeamHubPersonalProfileRevision[],
  current: TeamHubPersonalProfileRevision,
) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/personal-profile", () => ({
    current,
    has_more: false,
    history,
  }));
  const router = createMemoryRouter(
    [
      {
        element: <RememberedPage />,
        path: "/t/:tenantId/library/remembered",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/library/remembered"] },
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

describe("RememberedPage", () => {
  it("shows what changed since the previous profile", async () => {
    const previous = structuredClone(seedProfile);
    const current = structuredClone(seedProfile);
    current.preferences.overview = "Prefers a written decision.";
    renderPage(
      [revision("current", current), revision("older", previous)],
      revision("current", current),
    );
    expect(
      await screen.findByText("1 change since the previous profile."),
    ).toBeVisible();
    expect(screen.getByText("Now: Prefers a written decision.")).toBeVisible();
    expect(screen.getByText("Before: Prefers async updates.")).toBeVisible();
  });

  it("says when this is the first profile", async () => {
    const current = revision("only", seedProfile);
    renderPage([current], current);
    expect(
      await screen.findByText(
        "This is the first profile Another Me has written.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Jenny Bin")).toBeVisible();
  });

  it("shows a retryable alert instead of an empty state when the profile fails to load", async () => {
    const runtime = createTestTeamHubRuntime();
    const current = revision("only", seedProfile);
    let attempts = 0;
    runtime.server.on("GET", "/v0/tenants/{tenantId}/personal-profile", () => {
      attempts += 1;
      if (attempts === 1) {
        return teamHubErrorResponse(500, "UNAVAILABLE", "Profile failed.");
      }
      return { current, has_more: false, history: [current] };
    });
    const router = createMemoryRouter(
      [
        {
          element: <RememberedPage />,
          path: "/t/:tenantId/library/remembered",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/library/remembered"] },
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
      "Could not load what Another Me remembers.",
    );
    expect(
      screen.queryByText("Another Me has not written a profile yet."),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Jenny Bin")).toBeVisible();
  });
});
