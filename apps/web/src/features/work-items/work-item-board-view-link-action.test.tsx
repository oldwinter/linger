import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineGlobalProperty } from "@/test/global-properties";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { createWorkItemDashboardFilters } from "./work-item-dashboard-filters";
import { createWorkItemDashboardSort } from "./work-item-sort";
import { WorkItemsPage } from "./work-items-page";

const WORK_ITEMS_PATH = "/v0/tenants/{tenantId}/work-items";
const BOARD_PATH = "/t/tenant-northstar/dashboard";

describe("Copy the Work Items board's view link", () => {
  it("copies the filtered board's own link without refetching or moving", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        id: "workitem-plan",
        priority: "high",
        title: "Plan the release",
      }),
      workItem(human, {
        id: "workitem-budget",
        priority: "low",
        title: "Review the budget",
      }),
    ]);

    renderPage(runtime);
    await screen.findByText("Plan the release");

    fireEvent.click(screen.getByLabelText("Priority"));
    fireEvent.click(await screen.findByRole("option", { name: "High" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Filter by title" }),
      { target: { value: "release plan" } },
    );
    fireEvent.click(screen.getByLabelText("Sort"));
    fireEvent.click(await screen.findByRole("option", { name: "Most urgent" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("sort=priority"),
    );
    const readsBefore = runtime.server.requestsTo(
      "GET",
      WORK_ITEMS_PATH,
    ).length;

    fireEvent.click(screen.getByRole("button", { name: "Export & share" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy view link" }));

    const copied = `${window.location.origin}${BOARD_PATH}?q=release+plan&priority=high&sort=priority`;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(copied));
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    expect(screen.getByTestId("location")).toHaveTextContent(
      `${BOARD_PATH}?q=release+plan&priority=high&sort=priority`,
    );
    expect(runtime.server.requestsTo("GET", WORK_ITEMS_PATH).length).toBe(
      readsBefore,
    );

    const params = new URL(copied).searchParams;
    expect(createWorkItemDashboardFilters(params)).toEqual({
      archived: false,
      assignment: "all",
      execution: "",
      priority: "high",
      room: "",
      text: "release plan",
    });
    expect(createWorkItemDashboardSort(params.get("sort"))).toBe("priority");
  });

  it("copies the bare board link when nothing narrows the board", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("button", { name: "Export & share" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy view link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}${BOARD_PATH}`,
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("says the copy failed instead of claiming success", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    defineGlobalProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("button", { name: "Export & share" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy view link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
  });
});

function stubClipboard(writeText: () => Promise<void>) {
  const write = vi.fn(writeText);
  Object.assign(navigator, { clipboard: { writeText: write } });
  return write;
}

async function testRuntime() {
  return createTestTeamHubRuntime();
}

function renderPage(runtime: TestTeamHubRuntime, initialEntry = BOARD_PATH) {
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

function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}
