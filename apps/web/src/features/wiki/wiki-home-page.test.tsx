import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { localCalendarDay } from "@/features/memory/on-this-day";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import {
  clearAllRecentWikiPages,
  recordRecentWikiPage,
} from "./recent-wiki-pages";
import { WikiHomePage } from "./wiki-home-page";
import {
  serveWikiDocuments,
  serveWikiStatus,
  wikiDocument,
} from "./wiki.test-support";

vi.mock("@/components/read-only-blocknote-document-loader", () => ({
  ReadOnlyBlockNoteDocumentLoader: ({ markdown }: { markdown: string }) => (
    <article>{markdown}</article>
  ),
}));

afterEach(() => {
  clearAllRecentWikiPages();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("waits with the page Another Me finished yesterday until it is opened", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 16, 12));
  const runtime = createTestTeamHubRuntime();
  const page = wikiDocument("project-one", "Launch.md", "wiki_page");
  page.from[0]!.page_key = "projects/launch.md";
  page.updated_at = new Date(2026, 10, 15, 23, 10).toISOString();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [page],
    page: { has_more: false },
  });
  const router = createMemoryRouter(
    [{ path: "/t/:tenantId/library/wiki", element: <WikiHomePage /> }],
    { initialEntries: ["/t/tenant-northstar/library/wiki"] },
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
  expect(await screen.findByRole("link", { name: "Launch" })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/project-one",
  );
  recordRecentWikiPage("account-jenny", "tenant-northstar", {
    id: "project-one",
    name: "Launch",
    openedAt: new Date().toISOString(),
    path: "/t/tenant-northstar/documents/project-one",
  });
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Launch" })).toBeNull(),
  );
});
it("shows real collection pages on the Wiki tab and returns to Profile", async () => {
  const runtime = createTestTeamHubRuntime();
  const page = wikiDocument("project-one", "Launch.md", "wiki_page");
  page.from[0]!.page_key = "projects/launch.md";
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [page],
    page: { has_more: false },
  });
  const router = createMemoryRouter(
    [
      { path: "/t/:tenantId/library/wiki", element: <WikiHomePage /> },
      {
        path: "/t/:tenantId/documents/:documentId",
        element: <div>Document</div>,
      },
    ],
    { initialEntries: ["/t/tenant-northstar/library/wiki?tab=wiki"] },
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
  expect(await screen.findByRole("link", { name: /Launch/ })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/project-one",
  );
  fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
  expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.queryByRole("link", { name: /Launch/ })).toBeNull();
});

it("shows the pages a refresh has written as ordinary cards that open as pages", async () => {
  const runtime = createTestTeamHubRuntime();
  const published = wikiDocument("project-one", "Launch.md", "wiki_page");
  published.from[0]!.page_key = "projects/launch.md";
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [published],
    page: { has_more: false },
  });
  serveWikiStatus(runtime).mockResolvedValue({
    created_at: "2026-08-23T00:00:00.000Z",
    id: "wiki-tenant-northstar",
    latest_refresh_id: "refresh-1",
    owner_actor_id: "actor-human",
    preview_revision: 1,
    published_generation: 1,
    state: "refreshing",
    tenant_id: "tenant-northstar",
    updated_at: "2026-08-23T00:00:00.000Z",
  });
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/personal-wiki/preview",
    () => ({
      "projects/atlas.md": `---\n${JSON.stringify({ type: "Project", title: "Project Atlas", description: "Delivery analytics migration" })}\n---\n\n# Project Atlas\n\nBudget USD 210,000.\n`,
      "contacts/tom.md": `---\n${JSON.stringify({ type: "Contact", title: "Tom Becker", description: "Northwind sponsor" })}\n---\n\n# Tom Becker\n`,
    }),
  );
  const router = createMemoryRouter(
    [{ path: "/t/:tenantId/library/wiki", element: <WikiHomePage /> }],
    { initialEntries: ["/t/tenant-northstar/library/wiki?tab=wiki"] },
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
  const atlas = await screen.findByRole("link", { name: /Project Atlas/ });
  expect(atlas).toHaveTextContent("Delivery analytics migration");
  expect(atlas).not.toHaveTextContent("Updating");
  expect(atlas).toHaveAttribute(
    "href",
    "/t/tenant-northstar/wiki-preview?page=projects%2Fatlas.md",
  );
  expect(screen.getByRole("link", { name: /Launch/ })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/project-one",
  );
  expect(screen.getByRole("link", { name: /Tom Becker/ })).toHaveTextContent(
    "Northwind sponsor",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Another Me is writing your Wiki",
  );
  expect(
    screen.getByRole("link", { name: "Read 2 pages written so far" }),
  ).toHaveAttribute("href", "/t/tenant-northstar/library/wiki/writing");
  const writing = screen.getByRole("region", { name: "Wiki being written" });
  expect(writing).toHaveTextContent("Tom Becker");
  expect(writing).toHaveTextContent("2 pages written so far");
  expect(
    within(writing).getByRole("link", { name: "Open page" }),
  ).toHaveAttribute(
    "href",
    "/t/tenant-northstar/wiki-preview?page=contacts%2Ftom.md",
  );
  expect(screen.queryByText("No topics yet.")).toBeNull();
});

it("opens a random Wiki page from Surprise me", async () => {
  const runtime = createTestTeamHubRuntime();
  const launch = wikiDocument("project-one", "Launch.md", "wiki_page");
  launch.from[0]!.page_key = "projects/launch.md";
  const pricing = wikiDocument("topic-pricing", "Pricing.md", "wiki_page");
  pricing.from[0]!.page_key = "topics/pricing.md";
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [launch, pricing],
    page: { has_more: false },
  });
  const router = renderWikiHome(runtime);
  // Both pages are listed before the action can choose between them.
  await screen.findByRole("link", { name: /Pricing/ });
  vi.spyOn(Math, "random").mockReturnValue(0);

  fireEvent.click(screen.getByRole("button", { name: "Surprise me" }));

  expect(router.state.location.pathname).toBe(
    "/t/tenant-northstar/documents/project-one",
  );
  expect(await screen.findByText("Document")).toBeVisible();
});

it("offers no Surprise me before the Wiki has pages", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [],
    page: { has_more: false },
  });
  renderWikiHome(runtime);
  // The listing settles before the action's absence means anything.
  expect(await screen.findByText("No projects yet.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Surprise me" })).toBeNull();
});

it("shows the actionable failure reason when the latest Wiki refresh failed", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [],
    page: { has_more: false },
  });
  serveWikiStatus(runtime).mockResolvedValue({
    created_at: "2026-08-23T00:00:00.000Z",
    failure_reason: "runtime_incompatible",
    id: "wiki-tenant-northstar",
    latest_refresh_id: "refresh-2",
    owner_actor_id: "actor-human",
    published_generation: 0,
    state: "failed",
    tenant_id: "tenant-northstar",
    updated_at: "2026-08-23T00:00:00.000Z",
  });
  renderWikiHome(runtime);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Wiki update failed — Runtime incompatible. Update your local CLI or Linger.",
  );
});

it("never renders a Human Publish command", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [wikiDocument("page-one", "Page one", "wiki_page")],
    page: { has_more: false },
  });
  renderWikiHome(runtime);

  expect(
    await screen.findByRole("heading", { name: "Wiki", level: 1 }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
});

/** The Wiki home beside the page route a card opens. */
function renderWikiHome(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const router = createMemoryRouter(
    [
      { path: "/t/:tenantId/library/wiki", element: <WikiHomePage /> },
      {
        path: "/t/:tenantId/documents/:documentId",
        element: <div>Document</div>,
      },
      {
        path: "/t/:tenantId/library/wiki/graph",
        element: <div>Timeline</div>,
      },
    ],
    { initialEntries: ["/t/tenant-northstar/library/wiki?tab=wiki"] },
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
  return router;
}

it("features an earlier Daily and opens that day on the timeline", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [],
    page: { has_more: false },
  });
  const today = localCalendarDay();
  const week = calendarShift(today, -7);
  const entry = (day: string): TeamHubMemoryEntry => ({
    id: `daily-${day}`,
    kind: "daily",
    path: `timeline/daily/${day}.md`,
    date: day,
    title: `Daily ${day}`,
    summary: `What happened on ${day}`,
    updated_at: `${day}T00:00:00Z`,
    content: `---\ndescription: What happened on ${day}\n---\n`,
  });
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
    items: [entry(today), entry(week)],
  }));
  const router = renderWikiHome(runtime);
  const recall = await screen.findByRole("region", { name: "A week ago" });
  expect(recall).toHaveTextContent(`What happened on ${week}`);
  fireEvent.click(
    within(recall).getByRole("button", { name: `Open Daily for ${week}` }),
  );
  expect(router.state.location.pathname).toBe(
    "/t/tenant-northstar/library/wiki/graph",
  );
  expect(router.state.location.search).toBe(`?day=${week}`);
  expect(screen.getByText("Timeline")).toBeTruthy();
});

function calendarShift(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date + delta))
    .toISOString()
    .slice(0, 10);
}
