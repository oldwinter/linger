import {
  useQuery,
  useQueryClient,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import {
  createDocumentTestRuntime,
  seedFolder,
  seedNativeDocument,
  documentSeeds,
} from "@/test/document-scenarios";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import {
  useTeamHubRuntime,
  TeamHubRuntimeProvider,
} from "@/features/teamhub/teamhub-runtime";

import { LibraryLayout } from "./library-layout";
import { LibrarySidebar } from "./library-sidebar";
import {
  LibraryDocumentsPage,
  MyDocumentsTree,
} from "./library-documents-page";

describe("Library Home", () => {
  beforeEach(() => {
    defineGlobalProperty(window, "localStorage", {
      configurable: true,
      value: createTestStorage(),
    });
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers My pages, Shared with me, and Meetings without Favorite or Unfiled", async () => {
    const runtime = createDocumentTestRuntime();

    renderHome(runtime);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Library" }),
    ).toBeVisible();
    const tabs = within(
      screen.getByRole("tablist", { name: "Library views" }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "My pages",
      "Shared with me",
      "Meetings",
    ]);
    expect(screen.getByRole("tab", { name: "My pages" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("tab", { name: "Recent" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Favorites" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Unfiled" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Documents" })).toBeNull();
  });

  it("shows no sidebar on the Workspace home and keeps the tab in the URL", async () => {
    const runtime = createDocumentTestRuntime();

    const { router } = renderHome(runtime);
    expect(
      await screen.findByRole("tab", { name: "My pages" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.queryByRole("complementary", { name: "Library sidebar" }),
    ).toBeNull();
    expect(
      screen.queryByRole("separator", { name: "Resize Library sidebar" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Owned by Me tree" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Search documents" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "File type" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Sort documents" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Shared with me" }));
    expect(router.state.location.search).toBe("?tab=shared");
    expect(screen.getByRole("tab", { name: "Shared with me" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Meetings" }));
    expect(router.state.location.search).toBe("?tab=meetings");
    expect(
      screen.getByRole("radiogroup", { name: "Meeting range" }),
    ).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "File type" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "My pages" }));
    expect(router.state.location.search).toBe("");
  });

  it("lists canonical recently updated Documents as cards with source and owner", async () => {
    const runtime = createDocumentTestRuntime();

    renderHome(runtime);

    const recent = await screen.findByRole("region", { name: "Recent" });
    expect(
      await within(recent).findByRole("link", { name: "product-v0-brief.md" }),
    ).toBeVisible();
    expect(within(recent).getAllByText("Visible in room")[0]).toBeVisible();
    expect(within(recent).getAllByText("Jenny Bin")[0]).toBeVisible();
    expect(recent.querySelector("time")).not.toBeNull();
    // Download lives in the card's actions menu, not as its own button.
    expect(
      within(recent).queryByRole("button", {
        name: "Download product-v0-brief.md",
      }),
    ).toBeNull();
    expect(
      within(recent).getAllByRole("button", { name: /^Actions for / })[0],
    ).toBeVisible();
    expect(screen.queryByText(/blocknote/i)).not.toBeInTheDocument();
  });

  it("opens a recent file through its document route", async () => {
    const runtime = createDocumentTestRuntime();

    const { router } = renderHome(runtime);

    const recent = await screen.findByRole("region", { name: "Recent" });
    fireEvent.click(
      await within(recent).findByRole("link", { name: "product-v0-brief.md" }),
    );

    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/documents/document-product-v0-brief",
    );
  });

  it("restores the My Documents sidebar scroll position after route remount", async () => {
    const runtime = createDocumentTestRuntime();

    const first = renderHome(runtime, true);
    const sidebar = await screen.findByRole("complementary", {
      name: "Library sidebar",
    });
    sidebar.scrollTop = 180;
    fireEvent.scroll(sidebar);
    first.unmount();

    renderHome(runtime, true);

    expect(
      screen.getByRole("complementary", { name: "Library sidebar" }),
    ).toHaveProperty("scrollTop", 180);
  });

  it("creates an empty My Documents folder from the sidebar tree without an Artifact room", async () => {
    const runtime = createDocumentTestRuntime();

    const folder = seedFolder(runtime, "folder-new", { name: "New Folder" });
    documentSeeds(runtime).tree.items = [];
    runtime.server.on(
      "POST",
      "/v0/tenants/{tenantId}/me/document-folders",
      () => {
        documentSeeds(runtime).tree.items = [folder];
        return folder;
      },
    );
    renderHome(runtime, true);

    await chooseCreateAction("New folder");
    expect(
      await screen.findByRole("textbox", { name: "Rename folder" }),
    ).toHaveFocus();

    await vi.waitFor(async () => {
      await expect(
        teamHubData(
          runtime.client.api.GET("/v0/tenants/{tenantId}/me/document-tree", {
            params: { path: { tenantId: "tenant-northstar" } },
          }),
        ),
      ).resolves.toEqual({
        items: expect.arrayContaining([
          expect.objectContaining({ name: "New Folder", node_kind: "folder" }),
        ]),
      });
    });
  });

  it("creates a new document in user-files from the header New menu and opens it", async () => {
    const runtime = createDocumentTestRuntime();

    const document = seedNativeDocument(runtime, "new-page");
    runtime.server.on(
      "POST",
      "/v0/tenants/{tenantId}/documents",
      () => document,
    );
    runtime.server.on(
      "PUT",
      "/v0/tenants/{tenantId}/personal-wiki/documents/{documentId}",
      () => document,
    );
    const { router } = renderHome(runtime);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create in My pages" }),
    );
    const newFile = await screen.findByRole("menuitem", { name: "New file" });
    await waitFor(() => expect(newFile).toBeEnabled());
    fireEvent.click(newFile);

    await vi.waitFor(() => {
      expect(router.state.location.pathname).toMatch(
        /^\/t\/tenant-northstar\/documents\/document-/,
      );
    });
    expect(router.state.location.pathname).not.toContain("undefined");
  });

  it("places This day and What changed this week in a secondary nav pill bar outside Recent", async () => {
    const runtime = createDocumentTestRuntime();
    renderHome(runtime);

    const timeNav = await screen.findByRole("navigation", {
      name: "Library time views",
    });
    expect(
      within(timeNav).getByRole("link", { name: "This day" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/library/day");
    expect(
      within(timeNav).getByRole("link", { name: "What changed this week" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/library/changed");

    const recent = screen.getByRole("region", { name: "Recent" });
    expect(
      within(recent).queryByRole("link", { name: "What changed this week" }),
    ).toBeNull();
  });

  it("filters visible folders and documents with inline search, Escape, Clear, and filtered empty state", async () => {
    const runtime = createDocumentTestRuntime();
    const design = seedFolder(runtime, "folder-design", { name: "Design" });
    const spec = seedNativeDocument(runtime, "spec-guide", {
      parent_id: design.id,
    });
    spec.title = "spec-guide";
    const notes = seedNativeDocument(runtime, "daily-notes");
    notes.title = "daily-notes";

    renderHome(runtime);

    const search = await screen.findByRole("searchbox", {
      name: "Search documents and folders",
    });
    expect(search).toHaveAttribute(
      "placeholder",
      "Search documents and folders...",
    );
    expect(
      await screen.findByRole("button", { name: "Open folder Design" }),
    ).toBeVisible();

    // Matches folder and nested document inside the My pages list.
    fireEvent.change(search, { target: { value: "spec" } });
    const list = screen.getByLabelText("My pages documents");
    expect(
      within(list).getByRole("link", { name: "spec-guide.md" }),
    ).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "daily-notes.md" }),
    ).toBeNull();

    // Filtered empty state offers Clear filters.
    fireEvent.change(search, { target: { value: "no-such-file" } });
    expect(screen.getByText("No matching documents")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(search).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Open folder Design" }),
    ).toBeVisible();

    // Escape clears search.
    fireEvent.change(search, { target: { value: "Design" } });
    const filteredList = screen.getByLabelText("My pages documents");
    expect(
      within(filteredList).getByRole("button", { name: "Open folder Design" }),
    ).toBeVisible();
    expect(
      within(filteredList).queryByRole("link", { name: "daily-notes.md" }),
    ).toBeNull();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(
      within(screen.getByLabelText("My pages documents")).getByRole("link", {
        name: "daily-notes.md",
      }),
    ).toBeVisible();

    // Inline Clear button clears search.
    fireEvent.change(search, { target: { value: "daily" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
  });

  it("offers New file and Import CTAs in a genuine empty My pages state", async () => {
    const runtime = createDocumentTestRuntime();
    documentSeeds(runtime).tree.items = [];

    renderHome(runtime);

    expect(
      await screen.findByText("No documents created by you"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "New file" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Import" })).toBeVisible();
  });

  it("renames, moves, and deletes folders directly from Library home via folder ActionMenu", async () => {
    const runtime = createDocumentTestRuntime();
    const alpha = seedFolder(runtime, "folder-alpha", { name: "Alpha" });
    const archive = seedFolder(runtime, "folder-archive", { name: "Archive" });
    documentSeeds(runtime).tree.items = [alpha, archive];

    const patchCalls: Array<{ body: unknown; placementId: string }> = [];
    runtime.server.on(
      "PATCH",
      "/v0/tenants/{tenantId}/me/document-placements/{placementId}",
      ({ body, params }) => {
        patchCalls.push({ body, placementId: params.placementId ?? "" });
        const payload = body as { name?: string; parent_id?: string };
        documentSeeds(runtime).tree.items = documentSeeds(
          runtime,
        ).tree.items.map((item) =>
          item.id === params.placementId && item.node_kind === "folder"
            ? {
                ...item,
                ...(payload.name ? { name: payload.name } : {}),
                ...(payload.parent_id ? { parent_id: payload.parent_id } : {}),
              }
            : item,
        );
        return documentSeeds(runtime).tree.items.find(
          (item) => item.id === params.placementId,
        );
      },
    );
    const deleteCalls: string[] = [];
    runtime.server.on(
      "DELETE",
      "/v0/tenants/{tenantId}/me/document-folders/{placementId}",
      ({ params }) => {
        deleteCalls.push(params.placementId ?? "");
        documentSeeds(runtime).tree.items = documentSeeds(
          runtime,
        ).tree.items.filter((item) => item.id !== params.placementId);
      },
    );

    renderHome(runtime);

    // Rename Alpha -> Alpha Renamed
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Alpha" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const renameDialog = await screen.findByRole("dialog", {
      name: "Rename folder",
    });
    fireEvent.change(
      within(renameDialog).getByRole("textbox", { name: "Folder name" }),
      { target: { value: "Alpha Renamed" } },
    );
    fireEvent.click(within(renameDialog).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("button", { name: "Open folder Alpha Renamed" }),
    ).toBeVisible();
    expect(patchCalls[0]).toEqual({
      body: { name: "Alpha Renamed" },
      placementId: "folder-alpha",
    });

    // Move Alpha Renamed -> Archive
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Alpha Renamed" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move" }));
    const moveDialog = await screen.findByRole("dialog", {
      name: "Move Alpha Renamed to…",
    });
    fireEvent.click(
      within(moveDialog).getByRole("button", { name: "Select Archive" }),
    );
    fireEvent.click(
      within(moveDialog).getByRole("button", { name: "Move here" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open folder Alpha Renamed" }),
      ).toBeNull(),
    );
    expect(patchCalls[1]).toEqual({
      body: { parent_id: "folder-archive" },
      placementId: "folder-alpha",
    });

    // Delete Archive with confirmation dialog
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Archive" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const deleteDialog = await screen.findByRole("dialog", {
      name: "Delete folder",
    });
    fireEvent.click(
      within(deleteDialog).getByRole("button", { name: "Delete folder" }),
    );
    await waitFor(() => expect(deleteCalls).toEqual(["folder-archive"]));
  });

  it("switches back to My pages when creating a folder from Shared with me or Meetings", async () => {
    const runtime = createDocumentTestRuntime();
    documentSeeds(runtime).tree.items = [];
    runtime.server.on(
      "POST",
      "/v0/tenants/{tenantId}/me/document-folders",
      ({ body }) => {
        const name = (body as { name: string }).name;
        const created = seedFolder(runtime, "folder-created", { name });
        documentSeeds(runtime).tree.items = [created];
        return created;
      },
    );

    const { router } = renderHome(runtime);
    fireEvent.click(await screen.findByRole("tab", { name: "Shared with me" }));
    expect(router.state.location.search).toBe("?tab=shared");

    fireEvent.click(screen.getByRole("button", { name: "Create in My pages" }));
    const newFolder = await screen.findByRole("menuitem", {
      name: "New folder",
    });
    await waitFor(() => expect(newFolder).toBeEnabled());
    fireEvent.click(newFolder);

    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Folder name" }),
      { target: { value: "Quarterly" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(
      await screen.findByRole("button", { name: "Open folder Quarterly" }),
    ).toBeVisible();
  });
});

async function chooseCreateAction(action: "New folder") {
  fireEvent.click(
    await screen.findByRole("button", { name: "Create in Owned by Me" }),
  );
  const item = await screen.findByRole("menuitem", { name: action });
  await waitFor(() => expect(item).toBeEnabled());
  fireEvent.click(item);
}

function TreeSurface() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const queryKey = ["teamhub", "tenant-northstar", "document-tree"];
  const tree = useQuery({
    queryKey,
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/me/document-tree", {
          params: { path: { tenantId: "tenant-northstar" } },
        }),
      ),
  });
  return (
    <LibrarySidebar active="overview" tenantId="tenant-northstar">
      <MyDocumentsTree
        items={tree.data?.items ?? []}
        loadError={tree.error}
        pending={tree.isPending}
        tenantId="tenant-northstar"
        onChanged={() => queryClient.invalidateQueries({ queryKey })}
      />
    </LibrarySidebar>
  );
}

function renderHome(
  runtime: ReturnType<typeof createDocumentTestRuntime>,
  treeOnly = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        children: [
          {
            element: treeOnly ? <TreeSurface /> : <LibraryDocumentsPage />,
            index: true,
          },
        ],
        ...(treeOnly ? {} : { element: <LibraryLayout /> }),
        path: "/t/:tenantId/library",
      },
      {
        element: <p>Document surface</p>,
        path: "/t/:tenantId/documents/:documentId",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/library"] },
  );

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <Suspense fallback={<p>Loading Home</p>}>
          <div id="workspace-new-page-slot" />
          <RouterProvider router={router} />
        </Suspense>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );

  return { ...rendered, queryClient, router };
}

function createTestStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
