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
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";

import { WorkItemsPage } from "./work-items-page";

const ARCHIVE_PATH = "/v0/work-items/{workItemId}/archive";
const WORK_ITEMS_PATH = "/v0/tenants/{tenantId}/work-items";

describe("Work Items selection", () => {
  it("selects cards without opening the peek and counts them", async () => {
    const runtime = await seededRuntime();
    archiveRoutes(runtime);
    renderPage(runtime);
    await boardReady();

    expect(toolbar()).toBeNull();

    fireEvent.click(selectBox("Alpha item"));
    fireEvent.click(selectBox("Beta item"));

    expect(await screen.findByText("2 selected")).toBeVisible();
    expect(selectBox("Alpha item")).toBeChecked();
    expect(selectBox("Beta item")).toBeChecked();
    expect(selectBox("Gamma item")).not.toBeChecked();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears the selection from the toolbar", async () => {
    const runtime = await seededRuntime();
    archiveRoutes(runtime);
    renderPage(runtime);
    await boardReady();

    fireEvent.click(selectBox("Alpha item"));
    fireEvent.click(selectBox("Beta item"));
    fireEvent.click(
      within(await selectedToolbar()).getByRole("button", { name: "Clear" }),
    );

    await waitFor(() => expect(toolbar()).toBeNull());
    expect(selectBox("Alpha item")).not.toBeChecked();
    expect(selectBox("Beta item")).not.toBeChecked();
  });

  it("archives each selected Item once with its own version and key", async () => {
    const runtime = await seededRuntime();
    const posted: { body: unknown; path: string }[] = [];
    archiveRoutes(runtime, { posted });
    renderPage(runtime);
    await boardReady();
    const boardRequests = runtime.server.requestsTo(
      "GET",
      WORK_ITEMS_PATH,
    ).length;

    fireEvent.click(selectBox("Alpha item"));
    fireEvent.click(selectBox("Beta item"));
    fireEvent.click(
      within(await selectedToolbar()).getByRole("button", { name: "Archive" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Archived 2 items.",
    );
    expect(toolbar()?.textContent).toBe("Archived 2 items.");
    expect(screen.queryByText("2 selected")).toBeNull();
    const posts = runtime.server.requestsTo("POST", ARCHIVE_PATH);
    expect(posts).toHaveLength(2);
    const paths = posts.map((request) => new URL(request.url).pathname);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/v0/work-items/workitem-alpha/archive",
        "/v0/work-items/workitem-beta/archive",
      ]),
    );
    posted.sort((left, right) => left.path.localeCompare(right.path));
    expect(posted).toEqual([
      { body: { expected_version: 1 }, path: "workitem-alpha" },
      { body: { expected_version: 1 }, path: "workitem-beta" },
    ]);
    const keys = posts.map((request) => request.headers.get("Idempotency-Key"));
    expect(keys.every((key) => /^web:/u.test(key ?? ""))).toBe(true);
    expect(new Set(keys).size).toBe(2);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /Alpha item/ })).toBeNull(),
    );
    expect(screen.queryByRole("link", { name: /Beta item/ })).toBeNull();
    await waitFor(() =>
      expect(runtime.server.requestsTo("GET", WORK_ITEMS_PATH)).toHaveLength(
        boardRequests + 1,
      ),
    );
  });

  it("keeps the failed Items selected and names them", async () => {
    const runtime = await seededRuntime();
    archiveRoutes(runtime, { failFirst: "workitem-beta" });
    renderPage(runtime);
    await boardReady();

    fireEvent.click(selectBox("Alpha item"));
    fireEvent.click(selectBox("Beta item"));
    fireEvent.click(
      within(await selectedToolbar()).getByRole("button", { name: "Archive" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Archived 1 of 2 items. Failed: Beta item.",
    );
    expect(screen.queryByRole("link", { name: /Alpha item/ })).toBeNull();
    expect(selectBox("Beta item")).toBeChecked();
    expect(screen.getByText("1 selected")).toBeVisible();

    fireEvent.click(
      within(await selectedToolbar()).getByRole("button", { name: "Archive" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Archived 1 item.",
    );
    expect(toolbar()?.textContent).toBe("Archived 1 item.");
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /Beta item/ })).toBeNull(),
    );
    expect(runtime.server.requestsTo("POST", ARCHIVE_PATH)).toHaveLength(3);
  });

  it("drops a selected card that a filter hides", async () => {
    const runtime = await seededRuntime();
    archiveRoutes(runtime);
    renderPage(runtime);
    const filter = await boardReady();

    fireEvent.click(selectBox("Alpha item"));
    expect(await screen.findByText("1 selected")).toBeVisible();

    fireEvent.change(filter, { target: { value: "Beta" } });

    await waitFor(() => expect(toolbar()).toBeNull());
    fireEvent.change(filter, { target: { value: "" } });

    expect(selectBox("Alpha item")).not.toBeChecked();
    expect(toolbar()).toBeNull();
  });

  it("drops a selected card when its column collapses", async () => {
    const runtime = await seededRuntime();
    archiveRoutes(runtime);
    renderPage(runtime);
    await boardReady();

    fireEvent.click(selectBox("Closed item"));
    expect(await screen.findByText("1 selected")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Collapse closed" }));

    await waitFor(() => expect(toolbar()).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Expand closed" }));
    expect(selectBox("Closed item")).not.toBeChecked();
  });

  it("selects the only card on a one-card board", async () => {
    const runtime = await seededRuntime({ single: true });
    archiveRoutes(runtime);
    renderPage(runtime);
    await boardReady();

    fireEvent.click(selectBox("Alpha item"));

    expect(await screen.findByText("1 selected")).toBeVisible();
    fireEvent.click(
      within(await selectedToolbar()).getByRole("button", { name: "Clear" }),
    );
    await waitFor(() => expect(toolbar()).toBeNull());
  });

  it("keeps the keyboard ring when a card is selected", async () => {
    const runtime = await seededRuntime();
    archiveRoutes(runtime);
    renderPage(runtime);
    await boardReady();

    press("j");
    expect(ringedCardId()).toBe("workitem-alpha");
    fireEvent.click(selectBox("Beta item"));

    expect(await screen.findByText("1 selected")).toBeVisible();
    expect(ringedCardId()).toBe("workitem-alpha");
    expect(screen.queryByRole("dialog")).toBeNull();

    // Enter on the checkbox belongs to the checkbox, not the board.
    press("Enter", selectBox("Beta item"));
    expect(screen.queryByRole("dialog")).toBeNull();

    press("Enter");
    expect(
      await screen.findByRole("dialog", { name: "Alpha item" }),
    ).toBeVisible();
  });

  it("offers no selection on a board with no cards", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.seed.workItems = [];
    archiveRoutes(runtime);
    renderPage(runtime);

    await screen.findByText("No Work Items yet");

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(toolbar()).toBeNull();
  });

  it("leaves the board's URL state alone", async () => {
    const runtime = await seededRuntime();
    archiveRoutes(runtime);
    renderPage(runtime);
    await boardReady();
    const before = screen.getByTestId("location").textContent;

    fireEvent.click(selectBox("Alpha item"));
    fireEvent.click(selectBox("Beta item"));
    fireEvent.click(
      within(await selectedToolbar()).getByRole("button", { name: "Archive" }),
    );
    await screen.findByRole("status");

    expect(screen.getByTestId("location").textContent).toBe(before);
  });
});

function toolbar() {
  return screen.queryByRole("group", { name: "Selected Work Items" });
}

async function selectedToolbar() {
  return screen.findByRole("group", { name: "Selected Work Items" });
}

function selectBox(title: string) {
  return screen.getByRole("checkbox", { name: `Select ${title}` });
}

function ringedCardId() {
  return document.querySelector<HTMLElement>('[data-keyboard-focus="true"]')
    ?.dataset.workItemId;
}

function press(key: string, target: Element = document.body) {
  fireEvent.keyDown(target, { key });
}

async function boardReady() {
  return screen.findByRole("searchbox", { name: "Filter by title" });
}

/**
 * Answers each archive, recording what it saw. `failFirst` names the Items
 * whose first archive attempt fails, which leaves them selected for a retry.
 */
function archiveRoutes(
  runtime: TestTeamHubRuntime,
  {
    failFirst,
    posted = [],
  }: {
    failFirst?: string;
    posted?: { body: unknown; path: string }[];
  } = {},
) {
  let failed = false;
  runtime.server.on("POST", ARCHIVE_PATH, ({ body, params }) => {
    const workItemId = params.workItemId!;
    posted.push({ body, path: workItemId });
    if (failFirst === workItemId && !failed) {
      failed = true;
      return teamHubErrorResponse(
        409,
        "WORK_ITEM_VERSION_CONFLICT",
        "The Work Item changed.",
      );
    }
    const item = runtime.seed.workItems.find(
      (candidate) => candidate.id === workItemId,
    );
    if (!item) return teamHubErrorResponse(404, "WORK_ITEM_NOT_FOUND");
    const archivedItem: TeamHubWorkItem = {
      ...item,
      archived_at: "2026-07-30T12:00:00Z",
      updated_at: "2026-07-30T12:00:00Z",
      version: item.version + 1,
    };
    runtime.seed.workItems = runtime.seed.workItems.map((candidate) =>
      candidate.id === workItemId ? archivedItem : candidate,
    );
    return archivedItem;
  });
}

async function seededRuntime({ single = false }: { single?: boolean } = {}) {
  const runtime = createTestTeamHubRuntime();
  const actor = runtime.seed.identity.actors[0]!;
  const items = [
    workItem(actor, {
      id: "workitem-alpha",
      title: "Alpha item",
      updated_at: "2026-07-30T00:00:03Z",
    }),
    workItem(actor, {
      id: "workitem-beta",
      title: "Beta item",
      updated_at: "2026-07-30T00:00:02Z",
    }),
    workItem(actor, {
      id: "workitem-gamma",
      state: "in_progress",
      title: "Gamma item",
      updated_at: "2026-07-30T00:00:01Z",
    }),
    workItem(actor, {
      id: "workitem-closed",
      resolution: "not_planned",
      state: "resolved",
      title: "Closed item",
      updated_at: "2026-07-30T00:00:00Z",
    }),
  ];
  runtime.seed.workItems = single ? items.slice(0, 1) : items;
  return runtime;
}

function workItem(
  actor: TeamHubWorkItem["created_by"],
  override: Partial<TeamHubWorkItem>,
): TeamHubWorkItem {
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "",
    explicit_access_grants: [],
    id: "workitem",
    kind: "issue",
    number: 1,
    priority: "medium",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: "Work Item",
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
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
