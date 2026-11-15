import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { dayKey } from "@/lib/date-format";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { WorkItemStoryPage } from "./work-item-story-page";

describe("WorkItemStoryPage", () => {
  it("shows the description, the story, and the room doing the work", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item: TeamHubWorkItem = {
      assignees: [],
      created_at: "2026-11-14T01:00:00Z",
      created_by: human,
      description: "Email login returns 500.",
      explicit_access_grants: [],
      id: "workitem-login",
      kind: "issue",
      mandate: {
        event_external_id: "evt-1",
        event_source: "gmail",
        guideline_version: 1,
        owner_actor_id: human.id,
        recorded_at: "2026-11-14T01:00:00Z",
        revoked: false,
        rule_id: "pr_0000000000000000000000000000000a",
        rule_text: "Client replies → remind directly",
        strength: "create_and_delegate",
      },
      number: 42,
      priority: "high",
      referenced_actors: [],
      state: "in_progress",
      tenant_id: "tenant-northstar",
      title: "Fix login failure",
      updated_at: "2026-11-14T02:00:00Z",
      updated_by: human,
      version: 2,
      work_room_id: "room-login",
    };
    runtime.seed.workItems = [item];
    runtime.server.on("GET", "/v0/work-items/{workItemId}/timeline", () => ({
      items: [
        {
          activity: {
            actor: human,
            details: {},
            id: "act_created",
            kind: "created",
            occurred_at: "2026-11-14T01:00:00Z",
            work_item_id: item.id,
          },
          type: "activity",
        },
        {
          comment: {
            author: human,
            body: "The login is still broken.",
            created_at: "2026-11-14T01:30:00Z",
            id: "comment_1",
            segments: [{ content: "The login is still broken.", type: "text" }],
            tenant_id: "tenant-northstar",
            updated_at: "2026-11-14T01:30:00Z",
            version: 1,
            work_item_id: item.id,
          },
          type: "comment",
        },
        {
          activity: {
            actor: human,
            details: {},
            id: "act_room",
            kind: "work_room_created",
            occurred_at: "2026-11-14T02:00:00Z",
            room_id: "room-login",
            work_item_id: item.id,
          },
          type: "activity",
        },
      ],
      page: { has_more: false },
    }));
    const router = createMemoryRouter(
      [
        {
          element: <WorkItemStoryPage />,
          path: "/t/:tenantId/work-items/:workItemId",
        },
      ],
      {
        initialEntries: ["/t/tenant-northstar/work-items/workitem-login"],
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
      await screen.findByRole("heading", { name: "Fix login failure" }),
    ).toBeVisible();
    expect(screen.getByText("Email login returns 500.")).toBeVisible();
    expect(
      screen.getByText(/Created and handed off by Another Me/),
    ).toBeVisible();
    expect(
      screen.getByText(`${human.display_name} opened this Work Item.`),
    ).toBeVisible();
    expect(screen.getByText("The login is still broken.")).toBeVisible();
    expect(
      screen.getByText(`${human.display_name} opened a Room for this work.`),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open the Room doing this work" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/rooms/room-login/chat");
    expect(
      screen.queryByRole("button", {
        name: /create|edit|archive|assign(?:ment)?|comment|start (?:agent )?run|cancel (?:agent )?run/i,
      }),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the Pocket note from the day the work was opened", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const opened = new Date(2026, 10, 14, 9, 0, 0);
    const day = dayKey(opened);
    runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () => ({
      items: [
        {
          date: day,
          id: "note-1",
          text: "Call Lisa about the quote.",
          updated_at: opened.toISOString(),
        },
      ],
      page: { has_more: false },
      today: day,
    }));
    runtime.seed.workItems = [
      {
        assignees: [],
        created_at: opened.toISOString(),
        created_by: human,
        description: "Write the follow-up.",
        explicit_access_grants: [],
        id: "workitem-follow-up",
        kind: "issue",
        number: 7,
        priority: "medium",
        referenced_actors: [],
        state: "open",
        tenant_id: "tenant-northstar",
        title: "Send the follow-up",
        updated_at: opened.toISOString(),
        updated_by: human,
        version: 1,
      },
    ];
    runtime.server.on("GET", "/v0/work-items/{workItemId}/timeline", () => ({
      items: [],
      page: { has_more: false },
    }));
    const router = createMemoryRouter(
      [
        {
          element: <WorkItemStoryPage />,
          path: "/t/:tenantId/work-items/:workItemId",
        },
      ],
      {
        initialEntries: ["/t/tenant-northstar/work-items/workitem-follow-up"],
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

    expect(await screen.findByText("Call Lisa about the quote.")).toBeVisible();
    expect(screen.getByText("Your Pocket note from that day")).toBeVisible();
  });
});
