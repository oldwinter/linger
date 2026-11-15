import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";

import { WorkItemsPage } from "./work-items-page";

describe("Work Items board keyboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves the ring forward and backward through the cards shown", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();
    const [first, second] = shownCardIds();

    press("j");
    expect(markedCardId()).toBe(first);
    expect(markedCards()).toHaveLength(1);

    press("j");
    expect(markedCardId()).toBe(second);
    press("k");
    expect(markedCardId()).toBe(first);

    press("ArrowDown");
    expect(markedCardId()).toBe(second);
    press("ArrowUp");
    expect(markedCardId()).toBe(first);
  });

  it("starts at the first card when the first move goes backward", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();

    press("k");

    expect(markedCardId()).toBe(shownCardIds()[0]);
  });

  it("stops at the last card instead of wrapping", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();
    const cardIds = shownCardIds();

    for (let step = 0; step < cardIds.length + 2; step += 1) press("j");

    expect(markedCardId()).toBe(cardIds.at(-1));
  });

  it("opens the marked Item's peek with Enter", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();

    press("j");
    press("Enter");

    const dialog = await screen.findByRole("dialog", { name: "Alpha item" });
    expect(dialog).toBeVisible();
  });

  it("leaves Enter to the control that has focus", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();

    press("j");
    press("Enter", screen.getByRole("button", { name: "Collapse closed" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops the ring on Escape without opening anything", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();

    press("j");
    expect(markedCardId()).not.toBeUndefined();

    press("Escape");

    expect(markedCardId()).toBeUndefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves Escape to an open peek", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();

    press("j");
    press("Enter");
    const dialog = await screen.findByRole("dialog", { name: "Alpha item" });

    press("Escape");

    expect(dialog).toBeVisible();
    expect(markedCardId()).toBe(shownCardIds()[0]);
  });

  it("does not move the ring while the title filter has focus", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    const filter = await boardReady();

    press("j", filter);

    expect(markedCardId()).toBeUndefined();
    expect(filter).toHaveValue("");
  });

  it("clears the ring when a filter hides its card", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    const filter = await boardReady();
    const [first] = shownCardIds();

    press("j");
    expect(markedCardId()).toBe(first);

    fireEvent.change(filter, { target: { value: "Beta" } });

    await waitFor(() => expect(shownCardIds()).toEqual(["workitem-beta"]));
    expect(markedCardId()).toBeUndefined();
  });

  it("keeps the ring when a filter still shows its card", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    const filter = await boardReady();
    const [first] = shownCardIds();

    press("j");
    fireEvent.change(filter, { target: { value: "Alpha" } });

    await waitFor(() => expect(shownCardIds()).toEqual(["workitem-alpha"]));
    expect(markedCardId()).toBe(first);
  });

  it("leaves the board's URL state alone", async () => {
    const runtime = await seededRuntime();
    renderPage(runtime);
    await boardReady();
    const before = screen.getByTestId("location").textContent;

    press("j");
    press("j");
    press("k");
    press("Enter");
    await screen.findByRole("dialog", { name: "Alpha item" });

    expect(screen.getByTestId("location").textContent).toBe(before);
  });

  it("scrolls the marked card into view without scrolling the page", async () => {
    const runtime = await seededRuntime();
    const cardScroll = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const pageScroll = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    renderPage(runtime);
    await boardReady();

    press("j");

    expect(cardScroll).toHaveBeenLastCalledWith({
      block: "nearest",
      inline: "nearest",
    });
    expect(pageScroll).not.toHaveBeenCalled();
  });
});

/** How many cards carry the keyboard ring; one at most. */
function markedCards() {
  return document.querySelectorAll('[data-keyboard-focus="true"]');
}

function markedCardId() {
  return (
    document.querySelector<HTMLElement>('[data-keyboard-focus="true"]')?.dataset
      .workItemId ?? undefined
  );
}

/** The cards in the order the board paints them: column by column. */
function shownCardIds() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-work-item-id]"),
  ).map((card) => card.dataset.workItemId!);
}

function press(key: string, target: Element = document.body) {
  fireEvent.keyDown(target, { key });
}

async function boardReady() {
  return screen.findByRole("searchbox", { name: "Filter by title" });
}

async function seededRuntime() {
  const runtime = createTestTeamHubRuntime();
  const actor = runtime.seed.identity.actors[0]!;
  runtime.seed.workItems = [
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
  ];
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
