import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { WorkItemsPage } from "./work-items-page";

function renderDashboard(
  runtime: TestTeamHubRuntime,
  initialEntry = "/t/tenant-northstar/dashboard",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Suspense fallback={null}>
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
          </Suspense>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function makeItem(
  actor: TeamHubWorkItem["created_by"],
  override: Partial<TeamHubWorkItem> = {},
): TeamHubWorkItem {
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "Initial issue description.",
    explicit_access_grants: [],
    id: "workitem-1",
    kind: "issue",
    number: 12,
    priority: "medium",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: "Stabilize onboarding flow",
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
}

describe("Work Items Dashboard Phase 3 features", () => {
  it("switches between Board and List views via URL query and renders table metadata and selection", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const agent = runtime.seed.actors.find(
      (actor) => actor.id === "actor-codex",
    )!;
    runtime.seed.workItems = [
      makeItem(human, {
        assignees: [
          {
            actor: agent,
            assigned_at: "2026-07-30T00:00:00Z",
            assigned_by: human,
          },
        ],
        id: "workitem-issue",
        number: 12,
        origin_room_id: "room-all",
        priority: "urgent",
        state: "open",
        title: "Fix release script",
      }),
      makeItem(human, {
        id: "workitem-task",
        kind: "task",
        number: 18,
        priority: "high",
        state: "in_progress",
        task_execution: {
          control_revision: 1,
          control_settled_revision: 1,
          desired_control: "run",
          execution_revision: 1,
          execution_updated_at: "2026-07-30T01:00:00Z",
          generation: 1,
          pending_control: false,
          status: "running",
        },
        title: "Run nightly checks",
      }),
    ];

    renderDashboard(runtime);

    await screen.findByText("Fix release script");
    const boardToggle = screen.getByRole("button", { name: "Board" });
    const listToggle = screen.getByRole("button", { name: "List" });
    expect(boardToggle).toHaveAttribute("aria-pressed", "true");
    expect(listToggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(listToggle);
    expect(listToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard?view=list",
    );

    const table = screen.getByRole("table", { name: "Work Items list" });
    expect(within(table).getByText("#12")).toBeVisible();
    expect(within(table).getByText("#18")).toBeVisible();
    expect(within(table).getByText("Urgent")).toBeVisible();
    expect(within(table).getByText("Agent running")).toBeVisible();
    expect(within(table).getByRole("link", { name: "#all" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms/room-all/chat",
    );

    // Selection works in List view too.
    fireEvent.click(
      within(table).getByRole("checkbox", {
        name: "Select Fix release script",
      }),
    );
    expect(screen.getByText("1 selected")).toBeVisible();

    // Switching back to Board removes ?view=list.
    fireEvent.click(boardToggle);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard",
    );
    expect(screen.queryByRole("table", { name: "Work Items list" })).toBeNull();
  });

  it("transitions an issue across columns via drag-and-drop and shows an alert on failure", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const todoItem = makeItem(human, {
      id: "workitem-drag",
      number: 21,
      state: "open",
      title: "Drag me across columns",
      version: 2,
    });
    const managedTask = makeItem(human, {
      id: "workitem-managed",
      kind: "task",
      number: 22,
      state: "in_progress",
      task_execution: {
        control_revision: 1,
        control_settled_revision: 1,
        desired_control: "run",
        execution_revision: 1,
        execution_updated_at: "2026-07-30T01:00:00Z",
        generation: 1,
        pending_control: false,
        status: "running",
      },
      title: "Managed Agent task",
    });
    runtime.seed.workItems = [todoItem, managedTask];

    const transitionCalls: unknown[] = [];
    let failNextTransition = false;
    runtime.server.on(
      "POST",
      "/v0/work-items/{workItemId}/transitions",
      ({ body, params }) => {
        transitionCalls.push({ body, workItemId: params.workItemId });
        if (failNextTransition) {
          return teamHubErrorResponse(409, "CONFLICT", "Version mismatch.");
        }
        const payload = body as {
          expected_version: number;
          resolution?: TeamHubWorkItem["resolution"];
          state: TeamHubWorkItem["state"];
        };
        const updated: TeamHubWorkItem = {
          ...todoItem,
          resolution: payload.resolution,
          state: payload.state,
          version: payload.expected_version + 1,
        };
        runtime.seed.workItems = [updated, managedTask];
        return updated;
      },
    );

    renderDashboard(runtime);

    const card = await screen.findByRole("link", {
      name: /Drag me across columns/,
    });
    const managedCard = screen.getByRole("link", {
      name: /Managed Agent task/,
    });
    expect(card).toHaveAttribute("draggable", "true");
    expect(managedCard).toHaveAttribute("draggable", "false");

    const inProgressColumn = screen.getByRole("region", {
      name: "In progress",
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      getData: vi.fn((type: string) =>
        type === "application/x-linger-work-item" || type === "text/plain"
          ? "workitem-drag"
          : "",
      ),
      setData: vi.fn(),
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(inProgressColumn, { dataTransfer });
    expect(inProgressColumn).toHaveAttribute("data-drop-target", "true");

    fireEvent.drop(inProgressColumn, { dataTransfer });
    fireEvent.dragEnd(card);

    await waitFor(() => expect(transitionCalls).toHaveLength(1));
    expect(transitionCalls[0]).toEqual({
      body: { expected_version: 2, state: "in_progress" },
      workItemId: "workitem-drag",
    });
    expect(
      await within(inProgressColumn).findByText("Drag me across columns"),
    ).toBeVisible();

    // Failed drag-and-drop rolls back and surfaces an inline error alert.
    failNextTransition = true;
    const movedCard = within(inProgressColumn).getByRole("link", {
      name: /Drag me across columns/,
    });
    const doneColumn = screen.getByRole("region", { name: "Done" });
    fireEvent.dragStart(movedCard, { dataTransfer });
    fireEvent.dragOver(doneColumn, { dataTransfer });
    fireEvent.drop(doneColumn, { dataTransfer });
    fireEvent.dragEnd(movedCard);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Version mismatch.",
    );
    expect(
      within(inProgressColumn).getByText("Drag me across columns"),
    ).toBeVisible();
  });

  it("edits Title, Description, Status, and Priority inline inside WorkItemDetailDrawer", async () => {
    const runtime = createTestTeamHubRuntime();
    const human = runtime.seed.identity.actors[0]!;
    let current = makeItem(human, {
      description: "Old details",
      id: "workitem-inline",
      number: 33,
      priority: "low",
      state: "open",
      title: "Original title",
      version: 1,
    });
    runtime.seed.workItems = [current];

    const patchBodies: unknown[] = [];
    const transitionBodies: unknown[] = [];
    runtime.server
      .on("PATCH", "/v0/work-items/{workItemId}", ({ body }) => {
        patchBodies.push(body);
        const payload = body as {
          description?: string;
          expected_version: number;
          priority?: TeamHubWorkItem["priority"];
          title?: string;
        };
        current = {
          ...current,
          description: payload.description ?? current.description,
          priority: payload.priority ?? current.priority,
          title: payload.title ?? current.title,
          version: payload.expected_version + 1,
        };
        runtime.seed.workItems = [current];
        return current;
      })
      .on("POST", "/v0/work-items/{workItemId}/transitions", ({ body }) => {
        transitionBodies.push(body);
        const payload = body as {
          expected_version: number;
          resolution?: TeamHubWorkItem["resolution"];
          state: TeamHubWorkItem["state"];
        };
        current = {
          ...current,
          resolution: payload.resolution,
          state: payload.state,
          version: payload.expected_version + 1,
        };
        runtime.seed.workItems = [current];
        return current;
      });

    renderDashboard(runtime, "/t/tenant-northstar/dashboard/workitem-inline");

    const detail = await screen.findByRole("complementary", {
      name: "Work Item details",
    });
    fireEvent.click(
      within(detail).getByRole("button", { name: "Edit Work Item" }),
    );

    // Pressing Escape while editing cancels editing without closing the drawer.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByRole("complementary", { name: "Work Item details" }),
    ).toBeVisible();
    expect(
      within(detail).getByRole("button", { name: "Edit Work Item" }),
    ).toBeVisible();

    // Open editor again and save Title, Description, Status, and Priority together.
    fireEvent.click(
      within(detail).getByRole("button", { name: "Edit Work Item" }),
    );
    fireEvent.change(within(detail).getByLabelText("Title"), {
      target: { value: "Refined title" },
    });
    fireEvent.change(within(detail).getByLabelText("Description"), {
      target: { value: "Updated details from drawer." },
    });
    fireEvent.click(within(detail).getByLabelText("Status"));
    fireEvent.click(await screen.findByRole("option", { name: "In progress" }));
    fireEvent.click(within(detail).getByLabelText("Priority"));
    fireEvent.click(await screen.findByRole("option", { name: "High" }));

    fireEvent.click(within(detail).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        within(detail).getByRole("heading", { name: "Refined title" }),
      ).toBeVisible(),
    );
    expect(
      within(detail).getByText("Updated details from drawer."),
    ).toBeVisible();
    expect(patchBodies).toEqual([
      {
        description: "Updated details from drawer.",
        expected_version: 1,
        priority: "high",
        title: "Refined title",
      },
    ]);
    // Transition runs with the version incremented by the PATCH call.
    expect(transitionBodies).toEqual([
      {
        expected_version: 2,
        state: "in_progress",
      },
    ]);
  });
});
