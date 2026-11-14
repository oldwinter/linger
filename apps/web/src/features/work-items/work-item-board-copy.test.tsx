import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

import { WorkItemsPage } from "./work-items-page";

const WORK_ITEMS_PATH = "/v0/tenants/{tenantId}/work-items";

describe("Copy the Work Items board as Markdown", () => {
  it("copies the board as shown without refetching or moving the page", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const agent = runtime.seed.actors.find(
      (actor) => actor.id === "actor-codex",
    )!;
    seedWorkItems(runtime, [
      workItem(human, {
        assignees: [assignment(agent)],
        id: "workitem-login",
        priority: "high",
        title: "Fix login failure",
      }),
      workItem(human, {
        id: "workitem-export",
        priority: "low",
        title: "Ship export",
      }),
    ]);

    renderPage(runtime, "/t/tenant-northstar/dashboard?priority=high");
    const copy = await screen.findByRole("button", {
      name: "Copy board as Markdown",
    });
    const readsBefore = runtime.server.requestsTo(
      "GET",
      WORK_ITEMS_PATH,
    ).length;

    fireEvent.click(copy);

    const origin = window.location.origin;
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "# Work Items",
          "",
          "Priority High · Sort Recently updated",
          "",
          "## Todo",
          `- [Fix login failure](${origin}/t/tenant-northstar/dashboard/workitem-login) · High priority · Assigned to Codex`,
          "",
        ].join("\n"),
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard?priority=high",
    );
    expect(runtime.server.requestsTo("GET", WORK_ITEMS_PATH).length).toBe(
      readsBefore,
    );
  });

  it("says the copy failed instead of claiming success", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy board as Markdown" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Copy failed");
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

function renderPage(
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

function assignment(
  actor: TeamHubWorkItem["created_by"],
): TeamHubWorkItem["assignees"][number] {
  return {
    actor,
    assigned_at: "2026-07-30T00:00:00Z",
    assigned_by: actor,
  };
}

function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}
