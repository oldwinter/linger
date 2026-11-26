import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { WorkItemPairPage } from "./work-item-pair-page";

describe("WorkItemPairPage", () => {
  it("reads two Work Items together and says how they differ", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const login: TeamHubWorkItem = {
      assignees: [],
      created_at: "2026-11-14T01:00:00Z",
      created_by: human,
      description: "Email login returns 500.",
      explicit_access_grants: [],
      id: "workitem-login",
      kind: "issue",
      number: 42,
      priority: "high",
      referenced_actors: [],
      state: "in_progress",
      tenant_id: "tenant-northstar",
      title: "Fix login",
      updated_at: "2026-11-14T02:00:00Z",
      updated_by: human,
      version: 2,
      work_room_id: "room-login",
    };
    const note: TeamHubWorkItem = {
      ...login,
      description: "The release note is still a draft.",
      id: "workitem-note",
      number: 43,
      priority: "low",
      state: "open",
      title: "Write the note",
      work_room_id: undefined,
    };
    runtime.seed.workItems = [login, note];
    runtime.server.on("GET", "/v0/work-items/{workItemId}/timeline", () => ({
      items: [
        {
          activity: {
            actor: human,
            details: {},
            id: "act_created",
            kind: "created",
            occurred_at: "2026-11-14T01:00:00Z",
            work_item_id: login.id,
          },
          type: "activity",
        },
      ],
      page: { has_more: false },
    }));
    const router = createMemoryRouter(
      [
        {
          element: <WorkItemPairPage />,
          path: "/t/:tenantId/dashboard/side-by-side",
        },
      ],
      {
        initialEntries: [
          "/t/tenant-northstar/dashboard/side-by-side?left=workitem-login&right=workitem-note",
        ],
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

    expect(
      await screen.findByRole("heading", { name: "Fix login" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Write the note" }),
    ).toBeVisible();
    expect(screen.getByText("Email login returns 500.")).toBeVisible();
    expect(
      screen.getByText("The release note is still a draft."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Fix login is in progress; Write the note is open. Fix login is high priority; Write the note is low priority. Fix login has a room doing the work; Write the note does not.",
      ),
    ).toBeVisible();
  });

  it("shows an alert with Retry on load error and keeps not-found messaging for 404s", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const recovered: TeamHubWorkItem = {
      assignees: [],
      created_at: "2026-11-14T01:00:00Z",
      created_by: human,
      description: "Recovered item.",
      explicit_access_grants: [],
      id: "workitem-error",
      kind: "issue",
      number: 10,
      priority: "high",
      referenced_actors: [],
      state: "open",
      tenant_id: "tenant-northstar",
      title: "Recovered work item",
      updated_at: "2026-11-14T01:00:00Z",
      updated_by: human,
      version: 1,
    };
    let errorAttempts = 0;
    const getItem = vi.fn<TestRouteHandler>(({ params }) => {
      if (params.workItemId === "workitem-missing") {
        return teamHubErrorResponse(404, "WORK_ITEM_NOT_FOUND", "Not found.");
      }
      errorAttempts += 1;
      if (errorAttempts === 1) {
        return teamHubErrorResponse(
          503,
          "TEAMHUB_UNAVAILABLE",
          "Service unavailable.",
        );
      }
      return recovered;
    });
    runtime.server
      .on("GET", "/v0/work-items/{workItemId}", getItem)
      .on("GET", "/v0/work-items/{workItemId}/timeline", () => ({
        items: [],
        page: { has_more: false },
      }));
    const router = createMemoryRouter(
      [
        {
          element: <WorkItemPairPage />,
          path: "/t/:tenantId/dashboard/side-by-side",
        },
      ],
      {
        initialEntries: [
          "/t/tenant-northstar/dashboard/side-by-side?left=workitem-error&right=workitem-missing",
        ],
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Service unavailable.");
    expect(
      await screen.findByText("This Work Item is not on the Dashboard."),
    ).toBeVisible();

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("heading", { name: "Recovered work item" }),
    ).toBeVisible();
  });

  it("preserves board filters and sort on Back to the board", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server
      .on("GET", "/v0/work-items/{workItemId}", ({ params }) => ({
        assignees: [],
        created_at: "2026-11-14T00:00:00Z",
        created_by: runtime.seed.identity.actors[0]!,
        description: "Body",
        id: params.workItemId!,
        kind: "issue",
        number: 1,
        priority: "urgent",
        referenced_actors: [],
        state: "open",
        tenant_id: "tenant-northstar",
        title: `Item ${params.workItemId}`,
        updated_at: "2026-11-14T01:00:00Z",
        updated_by: runtime.seed.identity.actors[0]!,
        version: 1,
      }))
      .on("GET", "/v0/work-items/{workItemId}/timeline", () => ({
        items: [],
        page: { has_more: false },
      }));
    const from = encodeURIComponent("?priority=urgent&sort=priority");
    const router = createMemoryRouter(
      [
        {
          element: <WorkItemPairPage />,
          path: "/t/:tenantId/dashboard/side-by-side",
        },
      ],
      {
        initialEntries: [
          `/t/tenant-northstar/dashboard/side-by-side?left=wi-1&right=wi-2&from=${from}`,
        ],
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

    const back = await screen.findByRole("link", { name: "Back to the board" });
    expect(back).toHaveAttribute(
      "href",
      "/t/tenant-northstar/dashboard?priority=urgent&sort=priority",
    );
  });
});
