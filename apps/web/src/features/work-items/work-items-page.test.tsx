import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import type {
  TeamHubWorkItem,
  TeamHubWorkItemPage,
} from "@/features/teamhub/teamhub-types";
import { tenantWorkItemTargetQueryKey } from "./work-item-queries";
import { WorkItemsPage } from "./work-items-page";

const download = vi.hoisted(() => ({ triggerArtifactDownload: vi.fn() }));

vi.mock(
  "@/features/rooms/files/artifact-preview-loader",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/rooms/files/artifact-preview-loader")
    >()),
    triggerArtifactDownload: download.triggerArtifactDownload,
  }),
);

beforeEach(() => {
  download.triggerArtifactDownload.mockReset();
});

describe("Dashboard page", () => {
  it("renders the authoritative lifecycle as a five-column read-only board", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-todo", title: "Plan release" }),
      workItem(human, {
        id: "workitem-progress",
        state: "in_progress",
        title: "Implement release",
      }),
      workItem(human, {
        id: "workitem-done",
        resolution: "completed",
        state: "resolved",
        title: "Verify release",
      }),
      workItem(human, {
        id: "workitem-closed",
        resolution: "not_planned",
        state: "resolved",
        title: "Retire old release",
      }),
    ]);

    renderPage(runtime);

    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Todo" })).getByText(
        "Plan release",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "In progress" })).getByText(
        "Implement release",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Done" })).getByText(
        "Verify release",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Closed" })).getByText(
        "Retire old release",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create Work Item" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Task deep links focused without rendering a detail surface", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const item = workItem(human, {
      id: "workitem-linked",
      kind: "task",
      state: "in_progress",
      title: "Linked task",
    });
    seedWorkItems(runtime, [item]);

    renderPage(runtime, "/t/tenant-northstar/dashboard/workitem-linked");

    const card = await screen.findByRole("link", { name: /Linked task/ });
    expect(card).toHaveAttribute("aria-current", "location");
    expect(card).toHaveFocus();
    expect(screen.queryByText("Task status")).not.toBeInTheDocument();
    expect(screen.queryByText("Current phase")).not.toBeInTheDocument();
    expect(screen.queryByText("Delivery result")).not.toBeInTheDocument();
  });

  it("creates an issue without exposing other Work Item mutation controls", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human)]);

    renderPage(runtime);
    await screen.findByText("Fix login failure");

    expect(screen.getByRole("button", { name: "New issue" })).toBeVisible();
    const filters = screen.getByRole("group", { name: "Work Item filters" });
    expect(
      within(filters).getByRole("button", { name: "Archived" }),
    ).toBeVisible();
    expect(
      screen
        .queryAllByRole("button", {
          name: /create|edit|archive|assign(?:ment)?|comment|start (?:agent )?run|cancel (?:agent )?run/i,
        })
        .filter((button) => !filters.contains(button)),
    ).toEqual([]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows Room, creator, and assignee identity without actor filters", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const actors = runtime.seed.actors;
    const agent = actors.find((actor) => actor.id === "actor-codex")!;
    seedWorkItems(runtime, [
      workItem(human, {
        assignees: [
          {
            actor: agent,
            assigned_at: "2026-07-30T00:00:00Z",
            assigned_by: human,
          },
        ],
        origin_room_id: "room-all",
        priority: "high",
        title: "Ship release",
      }),
    ]);

    renderPage(runtime);

    const card = await screen.findByRole("link", { name: /Ship release/ });
    expect(within(card).getByText("High")).toBeVisible();
    expect(within(card).getByText("Jenny Bin")).toBeVisible();
    expect(
      within(card).getByRole("group", { name: "Assigned to Codex" }),
    ).toBeVisible();
    expect(
      within(card).getByRole("img", { name: "Codex avatar" }),
    ).toBeVisible();
    expect(within(card).queryByText(/Creator:/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/Assignees:/)).not.toBeInTheDocument();
    expect(within(card).getByText("#all")).toBeVisible();
    expect(within(card).getByText("Jul 30, 2026")).toBeVisible();
    expect(within(card).getByText("Todo")).toBeVisible();
  });

  it("wraps an unbroken Work Item title inside its card", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const title = "UnbrokenWorkItemTitle".repeat(12);
    seedWorkItems(runtime, [workItem(human, { title })]);

    renderPage(runtime);

    expect(await screen.findByText(title)).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
  });

  it("says when Another Me created a Work Item under the Human's rule", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        mandate: {
          owner_actor_id: human.id,
          rule_id: "pr_0000000000000000000000000000000a",
          rule_text: "Client contract changes → remind directly",
          guideline_version: 3,
          event_source: "gmail",
          event_external_id: "thread_1",
          strength: "create_and_delegate",
          revoked: true,
          recorded_at: "2026-07-30T00:00:00Z",
        },
      }),
    ]);

    renderPage(runtime);

    expect(
      await screen.findByText(
        "Created and delegated by Another Me under your rule “Client contract changes → remind directly” · mandate revoked",
      ),
    ).toBeVisible();
  });

  it("filters the complete board only by Room and preserves that filter in deep links", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const actors = runtime.seed.actors;
    const agent = actors.find((actor) => actor.id === "actor-codex")!;
    seedWorkItems(runtime, [
      workItem(human, {
        assignees: [
          {
            actor: agent,
            assigned_at: "2026-07-30T00:00:00Z",
            assigned_by: human,
          },
        ],
        id: "workitem-human",
        origin_room_id: "room-all",
        title: "Human-owned work",
      }),
      workItem(agent, {
        assignees: [
          {
            actor: human,
            assigned_at: "2026-07-30T00:00:00Z",
            assigned_by: human,
          },
        ],
        id: "workitem-agent",
        origin_room_id: "room-gtm-launch",
        title: "Agent-owned work",
      }),
    ]);

    renderPage(runtime);
    await screen.findByText("Human-owned work");

    expect(screen.queryByLabelText("Creator")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assignee")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Room"));
    fireEvent.click(await screen.findByRole("option", { name: "#gtm-launch" }));

    expect(screen.getByText("Agent-owned work")).toBeVisible();
    expect(screen.queryByText("Human-owned work")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard?room=room-gtm-launch",
    );

    expect(
      screen.getByRole("link", { name: /Agent-owned work/ }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/dashboard/workitem-agent?room=room-gtm-launch",
    );
    expect(screen.getByLabelText("Room")).toHaveValue("room-gtm-launch");
  });

  it("filters the board by priority and execution state", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        id: "workitem-high",
        priority: "high",
        title: "High priority work",
      }),
      workItem(human, {
        id: "workitem-low",
        priority: "low",
        title: "Low priority work",
      }),
      workItem(human, {
        id: "workitem-running",
        priority: "high",
        task_execution: taskExecution("running"),
        title: "Running work",
      }),
    ]);

    renderPage(runtime);
    await screen.findByText("High priority work");

    fireEvent.click(screen.getByLabelText("Priority"));
    fireEvent.click(await screen.findByRole("option", { name: "High" }));

    await waitFor(() =>
      expect(screen.queryByText("Low priority work")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("High priority work")).toBeVisible();
    expect(screen.getByText("Running work")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard?priority=high",
    );

    fireEvent.click(screen.getByLabelText("Execution"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Agent running" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("High priority work")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Running work")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "?priority=high&execution=running",
    );
  });

  it("filters by assignment and includes archived Work Items on request", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const agent = runtime.seed.actors.find(
      (actor) => actor.id === "actor-codex",
    )!;
    seedWorkItems(runtime, [
      workItem(human, {
        assignees: [assignment(human)],
        id: "workitem-mine",
        title: "My work",
      }),
      workItem(human, { id: "workitem-unassigned", title: "Unassigned work" }),
      workItem(human, {
        assignees: [assignment(agent)],
        id: "workitem-agent",
        title: "Agent work",
      }),
      workItem(human, {
        archived_at: "2026-07-30T09:00:00Z",
        id: "workitem-archived",
        title: "Archived work",
      }),
    ]);

    renderPage(runtime);
    await screen.findByText("My work");
    expect(screen.queryByText("Archived work")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Assignment"));
    fireEvent.click(await screen.findByRole("option", { name: "Mine" }));

    await waitFor(() =>
      expect(screen.queryByText("Agent work")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("My work")).toBeVisible();
    expect(screen.queryByText("Unassigned work")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "?assignment=mine",
    );

    fireEvent.click(screen.getByLabelText("Assignment"));
    fireEvent.click(await screen.findByRole("option", { name: "Unassigned" }));

    await waitFor(() =>
      expect(screen.getByText("Unassigned work")).toBeVisible(),
    );
    expect(screen.queryByText("My work")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Assignment"));
    fireEvent.click(await screen.findByRole("option", { name: "All" }));
    await waitFor(() => expect(screen.getByText("Agent work")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("Archived work")).toBeVisible();
    expect(screen.getByRole("button", { name: "Archived" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("location")).toHaveTextContent("archived=true");
  });

  it("narrows the board by title words and restores it with Clear", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-plan", title: "Plan the release" }),
      workItem(human, { id: "workitem-budget", title: "Review the budget" }),
    ]);

    renderPage(runtime);
    await screen.findByText("Plan the release");
    const input = screen.getByRole("searchbox", { name: "Filter by title" });

    fireEvent.change(input, { target: { value: "release PLAN" } });

    await waitFor(() =>
      expect(screen.queryByText("Review the budget")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Plan the release")).toBeVisible();
    expect(screen.getByText("1 of 2 items")).toBeVisible();
    expect(input).toHaveValue("release PLAN");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard?q=release+PLAN",
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear title filter" }));

    await waitFor(() =>
      expect(screen.getByText("Review the budget")).toBeVisible(),
    );
    expect(screen.getByText("2 items")).toBeVisible();
    expect(screen.getByTestId("location")).not.toHaveTextContent("q=");
  });

  it("says when a title query matches nothing and offers one clear step", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-plan", title: "Plan the release" }),
    ]);

    renderPage(runtime);
    await screen.findByText("Plan the release");

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Filter by title" }),
      {
        target: { value: "nothing" },
      },
    );

    expect(
      await screen.findByRole("heading", { name: "No Work Items match" }),
    ).toBeVisible();
    expect(
      screen.getByText("Only Work Item titles are searched."),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Todo" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));

    expect(await screen.findByText("Plan the release")).toBeVisible();
    expect(screen.getByRole("region", { name: "Todo" })).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Filter by title" }),
    ).toHaveValue("");
  });

  it("restores the title query from the URL and ignores descriptions", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-plan", title: "Plan the release" }),
      workItem(human, {
        description: "The release is blocked.",
        id: "workitem-login",
        title: "Fix login failure",
      }),
    ]);

    renderPage(runtime, "/t/tenant-northstar/dashboard?q=release");

    expect(await screen.findByText("Plan the release")).toBeVisible();
    expect(screen.queryByText("Fix login failure")).not.toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Filter by title" }),
    ).toHaveValue("release");
    expect(screen.getByTestId("location")).toHaveTextContent("?q=release");
  });

  it("replaces history per keystroke so back stays one step at a time", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-plan", title: "Plan release" }),
    ]);
    renderPage(runtime, "/t/tenant-northstar/dashboard", <BackProbe />);
    await screen.findByText("Plan release");

    const input = screen.getByRole("searchbox", { name: "Filter by title" });
    for (const value of ["p", "pl", "pla", "plan"]) {
      fireEvent.change(input, { target: { value } });
    }
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("q=plan"),
    );

    fireEvent.click(screen.getByLabelText("Sort"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Newest first" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Sort")).toHaveValue("newest"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Sort")).toHaveValue("updated"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("searchbox", { name: "Filter by title" }),
    ).toHaveValue("plan");
    expect(screen.getByTestId("location")).toHaveTextContent("q=plan");
  });

  it("keeps Dashboard filters in Work Item deep links", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        id: "workitem-high",
        priority: "high",
        title: "High priority work",
      }),
      workItem(human, {
        id: "workitem-low",
        priority: "low",
        title: "Low priority work",
      }),
    ]);

    renderPage(runtime);
    await screen.findByText("High priority work");
    fireEvent.click(screen.getByLabelText("Priority"));
    fireEvent.click(await screen.findByRole("option", { name: "High" }));
    await waitFor(() =>
      expect(screen.queryByText("Low priority work")).not.toBeInTheDocument(),
    );

    expect(
      screen.getByRole("link", { name: /High priority work/ }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/dashboard/workitem-high?priority=high",
    );
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
  });

  it("ignores legacy actor filters and drops them from Work Item deep links", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const actors = runtime.seed.actors;
    const agent = actors.find((actor) => actor.id === "actor-codex")!;
    seedWorkItems(runtime, [
      workItem(human, {
        assignees: [
          {
            actor: agent,
            assigned_at: "2026-07-30T00:00:00Z",
            assigned_by: human,
          },
        ],
        id: "workitem-human",
        origin_room_id: "room-all",
        title: "Human-created work",
      }),
      workItem(agent, {
        assignees: [
          {
            actor: human,
            assigned_at: "2026-07-30T00:00:00Z",
            assigned_by: human,
          },
        ],
        id: "workitem-agent",
        origin_room_id: "room-gtm-launch",
        title: "Agent-created work",
      }),
    ]);

    renderPage(
      runtime,
      "/t/tenant-northstar/dashboard?creator=missing-creator&assignee=missing-assignee&room=room-all",
    );
    await screen.findByText("Human-created work");

    expect(screen.queryByLabelText("Creator")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assignee")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Room")).toHaveValue("room-all");
    expect(screen.getByText("1 of 2 items")).toBeVisible();
    expect(screen.getByText("Human-created work")).toBeVisible();
    expect(screen.queryByText("Agent-created work")).not.toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /Human-created work/ }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/dashboard/workitem-human?room=room-all",
    );
  });

  it("reuses the Dashboard deep link and focuses the highlighted Work Item", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-focus", title: "Focused work" }),
    ]);

    renderPage(runtime, "/t/tenant-northstar/dashboard/workitem-focus");

    const focused = await screen.findByRole("link", { name: /Focused work/ });
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    expect(focused).toHaveAttribute("aria-current", "location");
    expect(focused).toHaveFocus();
  });

  it("keeps newer Dashboard state when a focused detail response is stale", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const current = workItem(human, {
      id: "workitem-focus",
      resolution: "completed",
      state: "resolved",
      title: "Current completed work",
      version: 2,
    });
    seedWorkItems(runtime, [current]);
    runtime.server.on("GET", WORK_ITEM_PATH, () =>
      workItem(human, {
        id: current.id,
        state: "open",
        title: "Stale open work",
        version: 1,
      }),
    );

    renderPage(runtime, "/t/tenant-northstar/dashboard/workitem-focus");

    const done = await screen.findByRole("region", { name: "Done" });
    expect(within(done).getByText("Current completed work")).toBeVisible();
    expect(screen.queryByText("Stale open work")).not.toBeInTheDocument();
  });

  it("loads a deep-linked archived Work Item that is absent from the default list", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const focusedItem = workItem(human, {
      archived_at: "2026-07-30T09:00:00Z",
      id: "workitem-archived",
      title: "Archived focused work",
    });
    seedWorkItems(runtime, []);
    runtime.server.on("GET", WORK_ITEM_PATH, () => focusedItem);

    renderPage(runtime, "/t/tenant-northstar/dashboard/workitem-archived");

    const focused = await screen.findByRole("link", {
      name: /Archived focused work/,
    });
    expect(focused).toHaveAttribute("aria-current", "location");
    expect(focused).toHaveFocus();
    expect(screen.getByText("1 item")).toBeVisible();
  });

  it("focuses a deep-linked Work Item after Dashboard data arrives", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const page = deferred<TeamHubWorkItemPage>();
    seedWorkItems(runtime, []);
    runtime.server
      .on("GET", WORK_ITEM_PATH, () =>
        workItem(human, {
          id: "workitem-delayed",
          title: "Delayed work",
        }),
      )
      .on("GET", WORK_ITEMS_PATH, () => page.promise);

    renderPage(runtime, "/t/tenant-northstar/dashboard/workitem-delayed");
    expect(
      await screen.findByRole("status", { name: "Loading Dashboard" }),
    ).toBeVisible();

    await act(async () => {
      page.resolve({
        items: [
          workItem(human, {
            id: "workitem-delayed",
            title: "Delayed work",
          }),
        ],
        page: { has_more: false },
      });
    });

    const focused = await screen.findByRole("link", { name: /Delayed work/ });
    expect(focused).toHaveAttribute("aria-current", "location");
    expect(focused).toHaveFocus();
  });

  it("keeps Closed records recoverable when the column is collapsed", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        resolution: "duplicate",
        state: "resolved",
        title: "Duplicate work",
      }),
    ]);

    renderPage(runtime);
    await screen.findByText("Duplicate work");

    fireEvent.click(screen.getByRole("button", { name: "Collapse closed" }));
    expect(screen.queryByText("Duplicate work")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Closed" })).getByText("1"),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Expand closed" }));
    expect(screen.getByText("Duplicate work")).toBeVisible();
  });

  it("shows an explicit empty state for a Tenant without Work Items", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, []);

    renderPage(runtime);

    expect(await screen.findByText("No Work Items yet")).toBeVisible();
    expect(screen.getByText("0 items")).toBeVisible();
  });

  it("shows an accessible Dashboard loading state", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, []);
    runtime.server.on(
      "GET",
      WORK_ITEMS_PATH,
      () => new Promise(() => undefined),
    );

    renderPage(runtime);

    expect(
      await screen.findByRole("status", { name: "Loading Dashboard" }),
    ).toBeVisible();
  });

  it("keeps a failed Dashboard query visible and retries it", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    seedWorkItems(runtime, []);
    const list = vi
      .fn<TestRouteHandler>()
      .mockReturnValueOnce(
        teamHubErrorResponse(
          503,
          "TEAMHUB_UNAVAILABLE",
          "TeamHub could not load Work Items.",
        ),
      )
      .mockReturnValueOnce({
        items: [workItem(human, { title: "Recovered work" })],
        page: { has_more: false },
      });
    runtime.server.on("GET", WORK_ITEMS_PATH, list);

    renderPage(runtime);

    expect(
      await screen.findByRole("heading", { name: "Dashboard unavailable" }),
    ).toBeVisible();
    expect(
      screen.getByText("TeamHub could not load Work Items."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Recovered work")).toBeVisible();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("disables retry while a failed focused detail is refetching", async () => {
    const runtime = await testRuntime();
    const identity = runtime.seed.identity;
    const human = identity.actors[0]!;
    const item = workItem(human, { id: "workitem-focus" });
    const retry = deferred<TeamHubWorkItem>();
    seedWorkItems(runtime, [item]);
    const get = vi
      .fn<TestRouteHandler>()
      .mockReturnValueOnce(item)
      .mockReturnValueOnce(
        teamHubErrorResponse(
          503,
          "TEAMHUB_UNAVAILABLE",
          "TeamHub could not load the focused Work Item.",
        ),
      )
      .mockReturnValueOnce(retry.promise);
    runtime.server.on("GET", WORK_ITEM_PATH, get);
    const queryClient = renderPage(
      runtime,
      "/t/tenant-northstar/dashboard/workitem-focus",
    );
    await screen.findByText("Fix login failure");
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: tenantWorkItemTargetQueryKey(
          "tenant-northstar",
          "workitem-focus",
        ),
      });
    });
    await screen.findByText("TeamHub could not load the focused Work Item.");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    const tryingAgain = await screen.findByRole("button", {
      name: "Trying again…",
    });
    expect(tryingAgain).toBeDisabled();
    await act(async () => retry.resolve(item));
    expect(await screen.findByText("Fix login failure")).toBeVisible();
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("distinguishes a forbidden Dashboard from a transport failure", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, []);
    runtime.server.on("GET", WORK_ITEMS_PATH, () =>
      teamHubErrorResponse(
        403,
        "FORBIDDEN",
        "This Tenant Dashboard is not available to you.",
      ),
    );

    renderPage(runtime);

    expect(
      await screen.findByRole("heading", { name: "Access denied" }),
    ).toBeVisible();
    expect(
      screen.getByText("This Tenant Dashboard is not available to you."),
    ).toBeVisible();
  });

  it("keeps the chosen order in the URL", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-todo", title: "Plan release" }),
    ]);
    renderPage(runtime);
    await screen.findByText("Plan release");

    expect(screen.getByLabelText("Sort")).toHaveValue("updated");
    fireEvent.click(screen.getByLabelText("Sort"));
    fireEvent.click(await screen.findByRole("option", { name: "Most urgent" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/t/tenant-northstar/dashboard?sort=priority",
      ),
    );
    expect(screen.getByLabelText("Sort")).toHaveValue("priority");
  });

  it("restores the previous order on back", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, { id: "workitem-todo", title: "Plan release" }),
    ]);
    renderPage(runtime, "/t/tenant-northstar/dashboard", <BackProbe />);
    await screen.findByText("Plan release");

    fireEvent.click(screen.getByLabelText("Sort"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Newest first" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Sort")).toHaveValue("newest"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).not.toHaveTextContent("sort="),
    );
    expect(screen.getByLabelText("Sort")).toHaveValue("updated");
  });

  it("renders cards in the chosen order inside each column", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        id: "workitem-low",
        priority: "low",
        title: "Low priority work",
      }),
      workItem(human, {
        id: "workitem-urgent",
        priority: "urgent",
        title: "Urgent work",
      }),
      workItem(human, {
        id: "workitem-high",
        priority: "high",
        title: "High priority work",
      }),
    ]);
    renderPage(runtime, "/t/tenant-northstar/dashboard?sort=priority");

    const todo = await screen.findByRole("region", { name: "Todo" });
    await waitFor(() =>
      expect(
        within(todo)
          .getAllByRole("link")
          .map((card) => card.getAttribute("data-work-item-id")),
      ).toEqual(["workitem-urgent", "workitem-high", "workitem-low"]),
    );
  });

  it("exports the filtered and sorted board as CSV", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        assignees: [assignment(human)],
        id: "workitem-plan",
        priority: "low",
        title: "Release plan",
      }),
      workItem(human, {
        id: "workitem-build",
        origin_room_id: "room-all",
        priority: "urgent",
        title: "Release build",
      }),
      workItem(human, {
        id: "workitem-ship",
        state: "in_progress",
        title: "Release ship",
      }),
      workItem(human, { id: "workitem-noise", title: "Unrelated work" }),
    ]);
    renderPage(runtime);
    await screen.findByText("Release plan");

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Filter by title" }),
      { target: { value: "release" } },
    );
    fireEvent.click(screen.getByLabelText("Sort"));
    fireEvent.click(await screen.findByRole("option", { name: "Most urgent" }));
    await waitFor(() =>
      expect(screen.queryByText("Unrelated work")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(download.triggerArtifactDownload).toHaveBeenCalledOnce();
    const [blob] = download.triggerArtifactDownload.mock.calls[0] as [
      Blob,
      string,
    ];
    const origin = window.location.origin;
    expect(await blob.text()).toBe(
      [
        "Title,Status,Priority,Assignees,Source Room,Updated,URL",
        `Release build,Todo,Urgent,,#all,2026-07-30T00:00:00Z,${origin}/t/tenant-northstar/dashboard/workitem-build`,
        `Release plan,Todo,Low,${human.display_name},No source room,2026-07-30T00:00:00Z,${origin}/t/tenant-northstar/dashboard/workitem-plan`,
        `Release ship,In progress,High,,No source room,2026-07-30T00:00:00Z,${origin}/t/tenant-northstar/dashboard/workitem-ship`,
        "",
      ].join("\n"),
    );
  });

  it("offers no CSV export for a board with no cards", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, []);

    renderPage(runtime);

    expect(await screen.findByText("No Work Items yet")).toBeVisible();
    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(exportButton).toBeDisabled();
    fireEvent.click(exportButton);
    expect(download.triggerArtifactDownload).not.toHaveBeenCalled();
  });
});

async function testRuntime() {
  const runtime = createTestTeamHubRuntime();

  return runtime;
}

function renderPage(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  initialEntry = "/t/tenant-northstar/dashboard",
  extra?: ReactNode,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Suspense fallback={<p>Loading...</p>}>
            <Routes>
              <Route
                element={<WorkItemsPage />}
                path="/t/:tenantId/dashboard"
              />
              <Route
                element={<WorkItemsPage />}
                path="/t/:tenantId/dashboard/:workItemId"
              />
            </Routes>
            <LocationProbe />
            {extra}
          </Suspense>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** A stand-in for the browser's back button inside MemoryRouter. */
function BackProbe() {
  const navigate = useNavigate();
  return (
    <button onClick={() => void navigate(-1)} type="button">
      Back
    </button>
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function workItem(
  actor: TeamHubWorkItem["created_by"],
  override: Partial<TeamHubWorkItem> = {},
): TeamHubWorkItem {
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "Email login returns 500.",
    explicit_access_grants: [],
    id: "workitem-login",
    kind: "issue",
    number: 42,
    priority: "high",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: "Fix login failure",
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
}

const WORK_ITEMS_PATH = "/v0/tenants/{tenantId}/work-items";
const WORK_ITEM_PATH = "/v0/work-items/{workItemId}";

function assignment(
  actor: TeamHubWorkItem["created_by"],
): TeamHubWorkItem["assignees"][number] {
  return {
    actor,
    assigned_at: "2026-07-30T00:00:00Z",
    assigned_by: actor,
  };
}

function taskExecution(
  status: NonNullable<TeamHubWorkItem["task_execution"]>["status"],
): NonNullable<TeamHubWorkItem["task_execution"]> {
  return {
    control_revision: 0,
    control_settled_revision: 0,
    desired_control: "run",
    execution_revision: 1,
    execution_updated_at: "2026-07-30T00:00:00Z",
    generation: 1,
    pending_control: false,
    status,
  };
}

/** Serves these Work Items from the test server. */
function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}
