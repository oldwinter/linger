import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { WorkspaceTreeContext } from "@/features/library/workspace-tree";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";
import { WikiPreviewPage } from "./wiki-preview-page";
import { readRecentWikiPages } from "./recent-wiki-pages";
import {
  serveWikiDocuments,
  serveWikiStatus,
  wikiDocument,
} from "./wiki.test-support";

it("opens a page being written in the published page layout", async () => {
  const runtime = createTestTeamHubRuntime();
  const contactOut = wikiDocument("client-one", "ContactOut.md", "wiki_page");
  contactOut.from[0]!.page_key = "clients/contactout.md";
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [contactOut],
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
      "projects/lev8.md": `---\n${JSON.stringify({ type: "Project", title: "Lev8" })}\n---\n\n# Lev8\n\nVisitor identity.\n\n[ContactOut](../clients/contactout.md)\n`,
    }),
  );
  const router = createMemoryRouter(
    [{ path: "/t/:tenantId/wiki-preview", element: <WikiPreviewPage /> }],
    {
      initialEntries: [
        "/t/tenant-northstar/wiki-preview?page=projects%2Flev8.md",
      ],
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
    await screen.findByRole("heading", { level: 1, name: "Lev8" }),
  ).toBeVisible();
  expect(screen.getByText("Lev8.md")).toBeVisible();
  expect(screen.getByText("Generating")).toHaveAttribute(
    "title",
    "Not published yet. This page may still change.",
  );
  expect(await screen.findByText(/Visitor identity\./)).toBeVisible();
  expect(screen.getByRole("link", { name: "ContactOut" })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/client-one",
  );
});

it("records the previewed page for the Wiki home", async () => {
  localStorage.clear();
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [],
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
      "projects/lev8.md": `---\n${JSON.stringify({ type: "Project", title: "Lev8" })}\n---\n\n# Lev8\n`,
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(teamHubIdentityQueryKey, runtime.seed.identity);
  const router = createMemoryRouter(
    [{ path: "/t/:tenantId/wiki-preview", element: <WikiPreviewPage /> }],
    {
      initialEntries: [
        "/t/tenant-northstar/wiki-preview?page=projects%2Flev8.md",
      ],
    },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", { level: 1, name: "Lev8" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(readRecentWikiPages("account-jenny", "tenant-northstar")).toEqual([
      {
        id: "projects/lev8",
        name: "Lev8",
        openedAt: expect.any(String),
        path: "/t/tenant-northstar/wiki-preview?page=projects%2Flev8.md",
      },
    ]),
  );
});

it("offers the mobile drawer toggle and Back to Wiki link on both loaded and missing previews", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [],
    page: { has_more: false },
  });
  serveWikiStatus(runtime).mockResolvedValue({
    created_at: "2026-08-23T00:00:00.000Z",
    id: "wiki-tenant-northstar",
    latest_refresh_id: "refresh-1",
    owner_actor_id: "actor-human",
    preview_revision: 1,
    published_generation: 1,
    state: "idle",
    tenant_id: "tenant-northstar",
    updated_at: "2026-08-23T00:00:00.000Z",
  });
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/personal-wiki/preview",
    () => ({}),
  );
  const setOpen = vi.fn();
  const router = createMemoryRouter(
    [{ path: "/t/:tenantId/wiki-preview", element: <WikiPreviewPage /> }],
    {
      initialEntries: [
        "/t/tenant-northstar/wiki-preview?page=projects%2Fmissing.md",
      ],
    },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <WorkspaceTreeContext value={{ open: false, setOpen }}>
          <RouterProvider router={router} />
        </WorkspaceTreeContext>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("This page was not published.")).toBeVisible();
  const backLinks = screen.getAllByRole("link", { name: "Back to Wiki" });
  expect(backLinks.length).toBeGreaterThan(0);
  for (const link of backLinks) {
    expect(link).toHaveAttribute("href", "/t/tenant-northstar/library/wiki");
  }
  fireEvent.click(screen.getByRole("button", { name: "Open Library pages" }));
  expect(setOpen).toHaveBeenCalledWith(true);
});
