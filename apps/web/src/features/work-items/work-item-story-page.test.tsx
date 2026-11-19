import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { dayKey } from "@/lib/date-format";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
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

  it("names the meeting that was underway when the work was opened", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const opened = new Date(2026, 10, 14, 10, 18, 0);
    const start = new Date(2026, 10, 14, 10, 0, 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    const path = `Meetings/${start.getFullYear()}/${pad(start.getMonth() + 1)}/${pad(start.getDate())}/Meeting ${pad(start.getHours())}-${pad(start.getMinutes())}-${pad(start.getSeconds())}`;
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
      items: [
        {
          content: "",
          id: "meeting-planning",
          kind: "meeting",
          meeting: {
            capture_id: "meeting-planning",
            recording_document_id: "audio",
            recording_filename: "room.m4a",
            recording_version_id: "v1",
            started_at: start.toISOString(),
            summary_ready: false,
            transcript_document_id: "transcript",
            transcript_version_id: "v1",
          },
          path,
          summary: "",
          title: path,
          updated_at: start.toISOString(),
        },
      ],
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

    expect(
      await screen.findByText(
        /Opened 18 minutes into Meeting · Nov 14, 10:00\./,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open that meeting" }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/library/meetings?entry=meeting-planning",
    );
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
  it("says when an assignee is not in the room doing the work", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    runtime.server.on("GET", "/v0/rooms/{roomId}/members", () => ({
      items: [
        {
          added_by: human,
          actor: human,
          joined_at: "2026-11-14T01:00:00Z",
          role: "owner",
          room_id: "room-login",
          updated_at: "2026-11-14T01:00:00Z",
        },
      ],
      page: { has_more: false },
    }));
    runtime.seed.workItems = [
      {
        assignees: [
          {
            actor: {
              display_name: "Codex",
              id: "actor-codex",
              kind: "agent",
              tenant_id: "tenant-northstar",
            },
            assigned_at: "2026-11-14T01:00:00Z",
            assigned_by: human,
          },
        ],
        created_at: "2026-11-14T01:00:00Z",
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
        updated_at: "2026-11-14T01:00:00Z",
        updated_by: human,
        version: 1,
        work_room_id: "room-login",
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

    expect(
      await screen.findByText(
        "Codex is assigned and is not in the room doing this work.",
      ),
    ).toBeVisible();
  });

  it("distinguishes a failed load with a Retry button from a 404 not-found state", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item: TeamHubWorkItem = {
      assignees: [],
      created_at: "2026-11-14T01:00:00Z",
      created_by: human,
      description: "Recovered after retry.",
      explicit_access_grants: [],
      id: "workitem-flaky",
      kind: "issue",
      number: 9,
      priority: "medium",
      referenced_actors: [],
      state: "open",
      tenant_id: "tenant-northstar",
      title: "Flaky work item",
      updated_at: "2026-11-14T01:00:00Z",
      updated_by: human,
      version: 1,
    };
    const getItem = vi
      .fn<TestRouteHandler>()
      .mockReturnValueOnce(
        teamHubErrorResponse(
          503,
          "TEAMHUB_UNAVAILABLE",
          "TeamHub is temporarily unavailable.",
        ),
      )
      .mockReturnValueOnce(item);
    runtime.server
      .on("GET", "/v0/work-items/{workItemId}", getItem)
      .on("GET", "/v0/work-items/{workItemId}/timeline", () => ({
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
        initialEntries: ["/t/tenant-northstar/work-items/workitem-flaky"],
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
    expect(alert).toHaveTextContent("TeamHub is temporarily unavailable.");
    expect(
      screen.queryByText("This Work Item is not on the Dashboard."),
    ).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("heading", { name: "Flaky work item" }),
    ).toBeVisible();
    expect(getItem).toHaveBeenCalledTimes(2);
  });
});
