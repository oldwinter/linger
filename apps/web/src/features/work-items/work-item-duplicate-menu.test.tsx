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
import type { TestRouteHandler } from "@/test/teamhub-test-server";

import { tenantWorkItemsDashboardQueryPrefix } from "./work-item-queries";
import { WorkItemsPage } from "./work-items-page";

const WORK_ITEMS_PATH = "/v0/tenants/{tenantId}/work-items";

describe("Duplicate a Work Item", () => {
  it("opens the create dialog on a copy and creates it only when confirmed", async () => {
    const runtime = await testRuntime();
    const original = workItem(runtime, {
      description: "Email login returns 500.",
      priority: "high",
      title: "Fix login failure",
    });
    seedWorkItems(runtime, [original]);
    const create = vi.fn<TestRouteHandler>(() =>
      createdWorkItem(runtime, {
        description: original.description,
        id: "workitem-copy",
        priority: "high",
        title: "Copy of Fix login failure",
      }),
    );
    runtime.server.on("POST", WORK_ITEMS_PATH, create);
    const queryClient = renderPage(runtime);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Actions for Fix login failure",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    const dialog = await screen.findByRole("dialog", { name: "New issue" });
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Copy of Fix login failure",
    );
    expect(within(dialog).getByLabelText("Description")).toHaveValue(
      "Email login returns 500.",
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Issue priority" }),
    ).toHaveTextContent("High");
    // Opening the dialog sends nothing; the person still confirms the copy.
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create issue" }),
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].body).toEqual({
      description: "Email login returns 500.",
      kind: "issue",
      priority: "high",
      title: "Copy of Fix login failure",
    });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/t/tenant-northstar/dashboard/workitem-copy",
      ),
    );
    // Only the create was written; the original keeps every field it had.
    expect(
      runtime.server.requests
        .filter((request) => request.method !== "GET")
        .map((request) => request.method),
    ).toEqual(["POST"]);
    await waitFor(() =>
      expect(cachedWorkItem(queryClient, original.id)).toMatchObject({
        description: "Email login returns 500.",
        priority: "high",
        title: "Fix login failure",
      }),
    );
  });
});

function cachedWorkItem(queryClient: QueryClient, id: string) {
  for (const [, data] of queryClient.getQueriesData<{
    items: TeamHubWorkItem[];
  }>({ queryKey: tenantWorkItemsDashboardQueryPrefix("tenant-northstar") })) {
    const item = data?.items.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  return undefined;
}

async function testRuntime() {
  return createTestTeamHubRuntime();
}

function renderPage(runtime: TestTeamHubRuntime) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={["/t/tenant-northstar/dashboard"]}>
          <Suspense fallback={<p>Loading...</p>}>
            <Routes>
              <Route
                element={<WorkItemsPage />}
                path="/t/:tenantId/dashboard"
              />
              <Route
                element={<p>Opened issue</p>}
                path="/t/:tenantId/dashboard/:workItemId"
              />
            </Routes>
            <LocationProbe />
          </Suspense>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
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

function workItem(
  runtime: TestTeamHubRuntime,
  override: Partial<TeamHubWorkItem> = {},
): TeamHubWorkItem {
  const actor = runtime.seed.identity.actors[0]!;
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "Email login returns 500.",
    explicit_access_grants: [],
    id: "workitem-login",
    kind: "issue",
    number: 42,
    priority: "medium",
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

function createdWorkItem(
  runtime: TestTeamHubRuntime,
  override: Partial<TeamHubWorkItem>,
): TeamHubWorkItem {
  return workItem(runtime, { number: 43, ...override });
}

function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}
