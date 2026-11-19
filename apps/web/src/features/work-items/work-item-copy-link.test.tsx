import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineGlobalProperty } from "@/test/global-properties";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { WorkItemsPage } from "./work-items-page";

const WORK_ITEM_LINK = "/t/tenant-northstar/dashboard/workitem-login";

describe("Copy Work Item link", () => {
  it("copies the dashboard link from the card menu and confirms it", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    seedWorkItems(runtime, [workItem(runtime, { title: "Fix login failure" })]);

    renderPage(runtime);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Actions for Fix login failure",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(WORK_ITEM_LINK));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says the copy failed instead of claiming success", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    defineGlobalProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const runtime = await testRuntime();
    seedWorkItems(runtime, [workItem(runtime, { title: "Fix login failure" })]);

    renderPage(runtime);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Actions for Fix login failure",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Copy failed");
  });

  it("copies the same link from the peek header", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    seedWorkItems(runtime, [workItem(runtime, { title: "Fix login failure" })]);

    renderPage(runtime);

    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(WORK_ITEM_LINK));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
    expect(dialog).toBeVisible();
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
            </Routes>
          </Suspense>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
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

function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}
