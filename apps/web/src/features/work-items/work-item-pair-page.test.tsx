import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
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
});
