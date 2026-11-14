import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Outlet } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WikiFileTree } from "./knowledge-sidebar-trees";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { serveWikiDocuments } from "./wiki.test-support";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("WikiFileTree", () => {
  it("starts every Wiki directory collapsed and hides navigation indexes", async () => {
    const runtime = await loggedInRuntime();
    serveWikiDocuments(runtime).mockResolvedValue({
      items: [
        wikiDocument("root-index", "Index", "wiki_page", "index.md"),
        wikiDocument("people-index", "Index", "wiki_page", "people/index.md"),
        wikiDocument(
          "person-casey-example",
          "Casey example",
          "wiki_page",
          "people/casey-example.md",
        ),
        wikiDocument(
          "projects-index",
          "Index",
          "wiki_page",
          "projects/index.md",
        ),
        wikiDocument("project-lev8", "Lev8", "wiki_page", "projects/lev8.md"),
        wikiDocument(
          "project-design",
          "Design",
          "wiki_page",
          "projects/lev8/design.md",
        ),
      ],
      page: { has_more: false },
    });
    renderPage(runtime);

    const pages = await screen.findByRole("region", { name: "Pages" });
    expect(within(pages).queryByText(/index\.md/i)).toBeNull();
    expect(pages.closest("aside")).toHaveAccessibleName("Wiki sidebar");
    expect(
      within(pages).getByRole("button", { name: "Expand people" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(pages).getByRole("button", { name: "Expand projects" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(pages).queryByText("casey-example.md")).toBeNull();
    expect(within(pages).queryByText("lev8.md")).toBeNull();
    fireEvent.click(
      within(pages).getByRole("button", { name: "Expand people" }),
    );
    expect(within(pages).getByText("casey-example.md")).toBeVisible();
    expect(within(pages).queryByText("lev8.md")).toBeNull();
    fireEvent.click(
      within(pages).getByRole("button", { name: "Expand projects" }),
    );
    expect(within(pages).getByText("lev8.md")).toBeVisible();
    expect(
      within(pages).getByRole("button", { name: "Expand lev8" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(pages).queryByText("design.md")).toBeNull();
    fireEvent.click(within(pages).getByRole("button", { name: "Expand lev8" }));
    expect(within(pages).getByText("design.md")).toBeVisible();

    fireEvent.click(
      within(pages).getByRole("button", { name: "Collapse people" }),
    );
    expect(
      within(pages).getByRole("button", { name: "Expand people" }),
    ).toBeVisible();
    expect(within(pages).queryByText("casey-example.md")).toBeNull();
  });

  it("narrows the tree to matches and restores the branches when cleared", async () => {
    const runtime = await loggedInRuntime();
    const served = serveSidebar(runtime);
    renderPage(runtime);

    const pages = await screen.findByRole("region", { name: "Pages" });
    fireEvent.click(
      within(pages).getByRole("button", { name: "Expand people" }),
    );
    expect(within(pages).getByText("casey-example.md")).toBeVisible();

    const field = within(pages).getByRole("searchbox", {
      name: "Filter Wiki pages",
    });
    fireEvent.change(field, { target: { value: "DESIGN" } });

    const match = within(pages).getByRole("link", { name: "design.md" });
    expect(match).toBeVisible();
    expect(within(match).getByText("design").tagName).toBe("MARK");
    expect(
      within(pages).getByRole("button", { name: "Collapse projects" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(pages).getByRole("button", { name: "Collapse lev8" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(pages).queryByRole("button", { name: /people/ })).toBeNull();
    expect(
      within(pages).queryByRole("link", { name: "casey-example.md" }),
    ).toBeNull();
    expect(served).toHaveBeenCalledTimes(1);

    // A folder folded while filtering stays folded only until the field clears.
    fireEvent.click(
      within(pages).getByRole("button", { name: "Collapse projects" }),
    );
    expect(within(pages).queryByRole("link", { name: "design.md" })).toBeNull();

    fireEvent.click(
      within(pages).getByRole("button", { name: "Clear Wiki filter" }),
    );

    expect(field).toHaveValue("");
    expect(
      within(pages).getByRole("button", { name: "Collapse people" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(pages).getByText("casey-example.md")).toBeVisible();
    expect(
      within(pages).getByRole("button", { name: "Expand projects" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(pages).queryByRole("link", { name: "design.md" })).toBeNull();
  });

  it("says when no page matches", async () => {
    const runtime = await loggedInRuntime();
    serveSidebar(runtime);
    renderPage(runtime);

    const pages = await screen.findByRole("region", { name: "Pages" });
    fireEvent.change(
      within(pages).getByRole("searchbox", { name: "Filter Wiki pages" }),
      { target: { value: "zzz" } },
    );

    expect(within(pages).getByText('No pages match "zzz".')).toBeVisible();
    expect(within(pages).queryAllByRole("link")).toHaveLength(0);
    expect(
      within(pages).queryAllByRole("button", { name: /Expand|Collapse/ }),
    ).toHaveLength(0);
  });

  it("leaves the open page selected and following links unchanged", async () => {
    const runtime = await loggedInRuntime();
    serveSidebar(runtime);
    const router = renderPage(runtime);

    const pages = await screen.findByRole("region", { name: "Pages" });
    fireEvent.change(
      within(pages).getByRole("searchbox", { name: "Filter Wiki pages" }),
      { target: { value: "casey" } },
    );
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/library/wiki",
    );

    fireEvent.click(
      within(pages).getByRole("link", { name: "casey-example.md" }),
    );

    expect(await screen.findByText("Shared Document editor")).toBeVisible();
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/documents/person-casey-example",
    );
    expect(
      within(pages).getByRole("link", { name: "casey-example.md" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("keeps the filter out of browser storage", async () => {
    const runtime = await loggedInRuntime();
    serveSidebar(runtime);
    renderPage(runtime);

    const pages = await screen.findByRole("region", { name: "Pages" });
    const before = storedEntries();
    fireEvent.change(
      within(pages).getByRole("searchbox", { name: "Filter Wiki pages" }),
      { target: { value: "casey" } },
    );

    expect(
      within(pages).getByRole("link", { name: "casey-example.md" }),
    ).toBeVisible();
    expect(storedEntries()).toEqual(before);
  });
});

function serveSidebar(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  return serveWikiDocuments(runtime).mockResolvedValue({
    items: [
      wikiDocument("root-index", "Index", "wiki_page", "index.md"),
      wikiDocument("people-index", "Index", "wiki_page", "people/index.md"),
      wikiDocument(
        "person-casey-example",
        "Casey example",
        "wiki_page",
        "people/casey-example.md",
      ),
      wikiDocument("projects-index", "Index", "wiki_page", "projects/index.md"),
      wikiDocument("project-lev8", "Lev8", "wiki_page", "projects/lev8.md"),
      wikiDocument(
        "project-design",
        "Design",
        "wiki_page",
        "projects/lev8/design.md",
      ),
    ],
    page: { has_more: false },
  });
}

function storedEntries() {
  return Object.entries(window.localStorage).sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );
}

async function loggedInRuntime() {
  const runtime = createTestTeamHubRuntime();

  return runtime;
}

function renderPage(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  initialEntry = "/t/tenant-northstar/library/wiki",
) {
  window.sessionStorage.setItem(
    "linger:library-owned-collapsed:v2:tenant-northstar",
    "false",
  );
  const router = createMemoryRouter(
    [
      {
        children: [
          { element: <div />, path: "/t/:tenantId/library/wiki" },
          {
            element: <div>Shared Document editor</div>,
            path: "/t/:tenantId/documents/:documentId",
          },
        ],
        element: (
          <>
            <aside aria-label="Wiki sidebar">
              <WikiFileTree tenantId="tenant-northstar" />
            </aside>
            <Outlet />
          </>
        ),
      },
    ],
    { initialEntries: [initialEntry] },
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

function wikiDocument(
  id: string,
  title: string,
  bindingKind: "wiki_page" | "wiki_source",
  pageKey?: string,
): TeamHubDocument {
  const timestamp = "2026-08-23T00:00:00.000Z";
  const actor = {
    display_name: bindingKind === "wiki_page" ? "Wiki Agent" : "Jenny",
    id: bindingKind === "wiki_page" ? "actor-agent" : "actor-human",
    kind: bindingKind === "wiki_page" ? ("agent" as const) : ("human" as const),
    tenant_id: "tenant-northstar",
  };
  return {
    capabilities: {
      comment: bindingKind === "wiki_page",
      delete: bindingKind === "wiki_source",
      duplicate: true,
      export: true,
      manage: bindingKind === "wiki_source",
      read: true,
      use_as_context: true,
      write: true,
    },
    created_at: timestamp,
    creator: actor,
    current_version: null,
    can_edit_native_content: bindingKind === "wiki_page",
    draft_capability: bindingKind === "wiki_page" ? "write" : "none",
    format: bindingKind === "wiki_page" ? "blocknote" : "markdown",
    representation_format: "markdown",
    from: [
      {
        binding_kind: bindingKind,
        context_id: "wiki-jenny",
        label: "Personal Wiki",
        ...(pageKey ? { page_key: pageKey } : {}),
      },
    ],
    id,
    owner: actor,
    status: "active",
    tenant_id: "tenant-northstar",
    title,
    updated_at: timestamp,
  };
}
