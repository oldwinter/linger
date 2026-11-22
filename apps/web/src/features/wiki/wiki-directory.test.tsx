import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LibraryLayout } from "@/features/library/library-layout";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  loggedInWikiRuntime,
  serveWikiDocuments,
  wikiDocument,
} from "./wiki.test-support";
import { WikiCollectionPage } from "./wiki-collection-page";
import { WikiGraphPage } from "@/features/memory/wiki-graph-page";
import { filterWikiGraph, wikiPageKey } from "./wiki-display-state";
import type { WikiGraphData } from "@/features/memory/wiki-graph-model";
import type { TeamHubPersonalProfileDocument } from "@/features/teamhub/teamhub-types";
import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";
import { readRecentWikiPages, writeRecentWikiPages } from "./recent-wiki-pages";

// Exercise Profile navigation and content with the real renderer, independently
// of the test server's first transform of the lazy Profile module.
beforeAll(async () => {
  await import("./wiki-profile-page");
}, 120_000);

afterEach(() => {
  window.localStorage.clear();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
});
const bodies: Record<string, string> = {
  "projects/alpha": "# Alpha notes\n\nA calm overview of the migration.",
  "projects/beta": "## Beta notes\n\nNorthwind delivery plan.",
};
const graph: WikiGraphData = {
  types: ["Project"],
  nodes: ["projects/alpha", "projects/beta"].map((id) => ({
    id,
    title: id,
    category: "Project",
    description: "",
    tags: [],
    body: bodies[id] ?? "",
    size: 1,
    links: ["projects/alpha"],
    backlinks: ["projects/beta"],
  })),
  edges: [{ source: "projects/alpha", target: "projects/beta" }],
};
const emptyModule = { overview: "", points: [] };
function profileDocument(
  overrides: Partial<TeamHubPersonalProfileDocument> = {},
): TeamHubPersonalProfileDocument {
  return {
    name: "Jenny Bin",
    background: {
      overview: "Existing personal profile",
      points: [],
      timeline: [],
    },
    communication_style: emptyModule,
    working_style: emptyModule,
    preferences: emptyModule,
    writing_style: emptyModule,
    ...overrides,
  };
}
const moduleHeadings = [
  "Background",
  "Communication style",
  "Working style",
  "Preferences",
  "Writing style",
];
function stubClipboard(write: () => Promise<void>) {
  const writeText = vi.fn(write);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

async function setup(
  initial = "/t/tenant-northstar/library/wiki",
  profile = profileDocument(),
  pageKeys: Record<string, string> = {},
  profileResponse?: object,
  documentsPending = false,
) {
  const runtime = await loggedInWikiRuntime();
  const pages = ["alpha", "beta"].map((id) => {
    const page = wikiDocument(id, id, "wiki_page");
    page.from[0]!.page_key = pageKeys[id] ?? `projects/${id}.md`;
    return page;
  });
  const documents = serveWikiDocuments(runtime);
  if (documentsPending) {
    documents.mockReturnValue(new Promise<never>(() => {}));
  } else {
    documents.mockResolvedValue({ items: pages, page: { has_more: false } });
  }
  runtime.server.on(
    "GET",
    "/v0/documents/{documentId}",
    ({ params }) => pages.find((page) => page.id === params.documentId)!,
  );
  vi.spyOn(runtime.client, "getPersonalProfile").mockResolvedValue(
    (profileResponse ?? { current: { profile } }) as Awaited<
      ReturnType<typeof runtime.client.getPersonalProfile>
    >,
  );
  vi.spyOn(
    runtime.client,
    "getPersonalKnowledgeGraphVisualization",
  ).mockResolvedValue(`const graph=${JSON.stringify(graph)};\n`);
  const router = createMemoryRouter(
    [
      {
        element: <LibraryLayout />,
        children: [
          {
            path: "/t/:tenantId/library/wiki/:collection?",
            element: <WikiCollectionPage />,
          },
          {
            path: "/t/:tenantId/library/wiki/graph",
            element: <WikiGraphPage />,
          },
          {
            path: "/t/:tenantId/documents/:documentId",
            element: <h1>Document</h1>,
          },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The shell's route loader caches the identity before any page renders.
  queryClient.setQueryData(teamHubIdentityQueryKey, runtime.seed.identity);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, runtime, queryClient, pages };
}
describe("Wiki directory", () => {
  it("opens Wiki on the Profile tab and switches to the Wiki tab", async () => {
    await setup();
    expect(
      screen.queryByRole("navigation", { name: "Wiki directory" }),
    ).toBeNull();
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
    expect(
      await screen.findByRole("article", { name: "Profile content" }),
    ).toHaveTextContent("Existing personal profile");
    const details = screen.getByRole("complementary", {
      name: "Profile details",
    });
    // The page title is Wiki; the name appears once, in the details card.
    const name = within(details).getByRole("heading", { level: 2 }).textContent;
    expect(screen.getAllByRole("heading", { name })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Wiki", level: 1 }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Change cover" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    const content = screen.getByRole("article", { name: "Profile content" });
    expect(content).toHaveAttribute("data-editable", "false");
    expect(
      within(content)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(moduleHeadings);
    expect(
      screen.getByRole("complementary", { name: "Profile details" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Wiki" }));
    expect(screen.getByRole("tab", { name: "Wiki" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("article", { name: "Profile content" }),
    ).toBeNull();
  });
  it("shows the account name once, in the details card, not in the Profile body", async () => {
    await setup("/t/tenant-northstar/library/wiki/profile");
    const content = await screen.findByRole("article", {
      name: "Profile content",
    });
    expect(screen.getAllByRole("heading", { name: "Jenny Bin" })).toHaveLength(
      1,
    );
    expect(
      within(content).queryByRole("heading", { name: "Jenny Bin" }),
    ).toBeNull();
    expect(content).toHaveTextContent("Existing personal profile");
  });
  it("renders each module from its fields as overview and point bullets", async () => {
    await setup(
      "/t/tenant-northstar/library/wiki/profile",
      profileDocument({
        background: {
          overview: "Runs research at Northstar.",
          points: [
            { title: "Current work", text: "Owns the roadmap.", items: [] },
          ],
          timeline: [],
        },
        communication_style: {
          overview: "# Not a heading *or emphasis*",
          points: [
            {
              title: "Meetings",
              text: "",
              items: ["Sends agendas first", "Writes follow-ups"],
            },
          ],
        },
      }),
    );
    const content = await screen.findByRole("article", {
      name: "Profile content",
    });
    await within(content).findByRole("heading", { name: "Background" });
    expect(
      within(content)
        .getAllByRole("heading")
        .map((heading) => [heading.tagName, heading.textContent]),
    ).toEqual(moduleHeadings.map((heading) => ["H2", heading]));
    const bullets = [
      ...content.querySelectorAll('[data-content-type="bulletListItem"]'),
    ].map((bullet) => bullet.textContent);
    expect(bullets).toEqual(
      expect.arrayContaining([
        "Current work: Owns the roadmap.",
        "Sends agendas first",
        "Writes follow-ups",
      ]),
    );
    expect(content).toHaveTextContent("# Not a heading *or emphasis*");
    expect(content).toHaveTextContent("Runs research at Northstar.");
  });
  it("renders the Background overview, then its timeline oldest first", async () => {
    const place = "\u676d\u5dde";
    await setup(
      "/t/tenant-northstar/library/wiki/profile",
      profileDocument({
        background: {
          overview: "Avery leads research.",
          points: [],
          timeline: [
            {
              period: "2026.02–Present",
              organization: "Example Co",
              place,
              role: "Product Manager",
              description: "Leads the voice product.",
              details: [
                "Owns the voice assistant launch.",
                "Works with the agent team.",
              ],
            },
            {
              period: "2019.06–2020.01",
              organization: "Example Lab",
              place: "",
              role: "",
              description: "Built screening models.",
              details: [],
            },
          ],
        },
      }),
    );
    const content = await screen.findByRole("article", {
      name: "Profile content",
    });
    await within(content).findByRole("heading", { name: "Background" });
    const timeline = within(content).getByRole("list", { name: "Timeline" });
    const entries = [
      ...timeline.querySelectorAll(".wiki-profile-timeline-entry"),
    ].map((entry) => entry.textContent);
    expect(entries).toEqual([
      "2019.06–2020.01Example LabBuilt screening models.",
      `2026.02–PresentExample Co · ${place}Product ManagerLeads the voice product.Owns the voice assistant launch.Works with the agent team.`,
    ]);
    const overview = within(content).getByText("Avery leads research.");
    expect(
      overview.compareDocumentPosition(timeline) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("sorts an upper-bound year as an end year in the timeline", async () => {
    const entry = (period: string, organization: string) => ({
      period,
      organization,
      place: "",
      role: "",
      description: "",
      details: [],
    });
    await setup(
      "/t/tenant-northstar/library/wiki/profile",
      profileDocument({
        background: {
          overview: "Avery leads research.",
          points: [],
          timeline: [
            entry("2020", "Example Co"),
            entry("\u22642020", "Example Lab"),
            entry("\u20132018", "Example University"),
          ],
        },
      }),
    );
    const content = await screen.findByRole("article", {
      name: "Profile content",
    });
    const timeline = await within(content).findByRole("list", {
      name: "Timeline",
    });
    const entries = [
      ...timeline.querySelectorAll(".wiki-profile-timeline-entry"),
    ].map((item) => item.textContent);
    expect(entries).toEqual([
      "\u20132018Example University",
      "\u22642020Example Lab",
      "2020Example Co",
    ]);
  });
  it("says the Profile is being written while an Agent builds it", async () => {
    await setup(
      "/t/tenant-northstar/library/wiki",
      undefined,
      {},
      {
        building_since: "2026-11-07T08:00:00Z",
      },
    );
    expect(await screen.findByText("Getting to know you…")).toBeVisible();
    expect(screen.queryByText(/Add a source under Sources/)).toBeNull();
  });
  it("keeps the current Profile under the update card", async () => {
    await setup(
      "/t/tenant-northstar/library/wiki",
      undefined,
      {},
      {
        building_since: "2026-11-07T08:00:00Z",
        current: { profile: profileDocument() },
      },
    );
    expect(
      await screen.findByText("Another Me is updating your profile"),
    ).toBeVisible();
    expect(await screen.findByText("Existing personal profile")).toBeVisible();
  });
  it("filters a collection page by name", async () => {
    await setup("/t/tenant-northstar/library/wiki/projects");
    const search = await screen.findByRole("searchbox", {
      name: "Search projects",
    });
    expect(await screen.findByRole("link", { name: /alpha/ })).toBeVisible();
    expect(screen.getByText("2 projects")).toBeVisible();
    fireEvent.change(search, { target: { value: "BET" } });
    expect(screen.getByText("1 of 2 projects")).toBeVisible();
    expect(screen.queryByRole("link", { name: /alpha/ })).toBeNull();
    expect(screen.getByRole("link", { name: /beta/ })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear Projects search" }),
    );
    expect(search).toHaveValue("");
    expect(screen.getByText("2 projects")).toBeVisible();
    fireEvent.change(search, { target: { value: "gamma" } });
    expect(screen.getByText("0 of 2 projects")).toBeVisible();
    expect(screen.getByText("No projects match “gamma”.")).toBeVisible();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
  });
  it("uses singular nouns for single-item collections", async () => {
    const first = await setup(
      "/t/tenant-northstar/library/wiki/projects",
      undefined,
      { alpha: "projects/alpha.md", beta: "topics/beta.md" },
    );
    expect(await screen.findByText("1 project")).toBeVisible();
    first.unmount();

    await setup("/t/tenant-northstar/library/wiki/clients", undefined, {
      alpha: "clients/alpha.md",
      beta: "topics/beta.md",
    });
    expect(await screen.findByText("1 company")).toBeVisible();
  });
  it("filters a collection page by body text", async () => {
    await setup("/t/tenant-northstar/library/wiki/projects");
    const search = await screen.findByRole("searchbox", {
      name: "Search projects",
    });
    expect(await screen.findByRole("link", { name: /alpha/ })).toBeVisible();
    fireEvent.change(search, { target: { value: "NORTHWIND" } });
    expect(screen.queryByRole("link", { name: /alpha/ })).toBeNull();
    expect(screen.getByRole("link", { name: /beta/ })).toBeVisible();
    expect(screen.getByText(/Northwind delivery plan\./)).toBeVisible();
  });
  it("copies the collection as a Markdown list of absolute links", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const { router } = await setup("/t/tenant-northstar/library/wiki/projects");
    expect(await screen.findByRole("link", { name: /alpha/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy list" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "# Projects",
          `- [alpha](${window.location.origin}/t/tenant-northstar/documents/alpha)`,
          `- [beta](${window.location.origin}/t/tenant-northstar/documents/beta)`,
        ].join("\n"),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/library/wiki/projects",
    );
  });
  it("copies only the pages the filter leaves", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    await setup("/t/tenant-northstar/library/wiki/projects");
    const search = await screen.findByRole("searchbox", {
      name: "Search projects",
    });
    fireEvent.change(search, { target: { value: "BET" } });

    fireEvent.click(screen.getByRole("button", { name: "Copy list" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "# Projects",
          `- [beta](${window.location.origin}/t/tenant-northstar/documents/beta)`,
        ].join("\n"),
      ),
    );
  });
  it("disables Copy list while the collection is loading", async () => {
    await setup(
      "/t/tenant-northstar/library/wiki/projects",
      undefined,
      {},
      undefined,
      true,
    );

    expect(await screen.findByText("Loading Wiki Documents…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy list" })).toBeDisabled();
  });
  it("disables Copy list when the collection has no pages", async () => {
    await setup("/t/tenant-northstar/library/wiki/projects", undefined, {
      alpha: "topics/alpha.md",
      beta: "topics/beta.md",
    });

    expect(await screen.findByText("No generated projects yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy list" })).toBeDisabled();
  });
  it("uses display labels for empty People and Companies collections", async () => {
    const first = await setup(
      "/t/tenant-northstar/library/wiki/contacts",
      undefined,
      { alpha: "topics/alpha.md", beta: "topics/beta.md" },
    );
    expect(await screen.findByText("No generated people yet.")).toBeVisible();
    expect(screen.queryByText("No generated contacts yet.")).toBeNull();
    first.unmount();

    await setup("/t/tenant-northstar/library/wiki/clients", undefined, {
      alpha: "topics/alpha.md",
      beta: "topics/beta.md",
    });
    expect(
      await screen.findByText("No generated companies yet."),
    ).toBeVisible();
    expect(screen.queryByText("No generated clients yet.")).toBeNull();
  });
  it("reports a refused clipboard write", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    await setup("/t/tenant-northstar/library/wiki/projects");
    expect(await screen.findByRole("link", { name: /alpha/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("records an opened Wiki page without another request", async () => {
    const { runtime } = await setup("/t/tenant-northstar/documents/alpha");
    expect(await screen.findByRole("link", { name: "beta" })).toBeVisible();

    await waitFor(() =>
      expect(readRecentWikiPages("account-jenny", "tenant-northstar")).toEqual([
        {
          id: "alpha",
          name: "alpha",
          openedAt: expect.any(String),
          path: "/t/tenant-northstar/documents/alpha",
        },
      ]),
    );
    expect(
      runtime.server.requestsTo("GET", "/v0/documents/{documentId}"),
    ).toHaveLength(1);
  });
  it("moves a page opened from the directory to the front of the list", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    fireEvent.click(await screen.findByRole("link", { name: "beta" }));

    await waitFor(() =>
      expect(
        readRecentWikiPages("account-jenny", "tenant-northstar").map(
          (row) => row.id,
        ),
      ).toEqual(["beta", "alpha"]),
    );
  });
  it("shows recently opened pages above the daily cards", async () => {
    writeRecentWikiPages("account-jenny", "tenant-northstar", [
      {
        id: "alpha",
        name: "Alpha notes",
        openedAt: "2026-08-23T00:00:00.000Z",
        path: "/t/tenant-northstar/documents/alpha",
      },
    ]);
    await setup("/t/tenant-northstar/library/wiki?tab=wiki");

    const strip = await screen.findByRole("region", {
      name: "Recently opened Wiki pages",
    });
    expect(screen.getByRole("link", { name: "Alpha notes" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/documents/alpha",
    );
    const daily = screen.getByRole("heading", { name: /Daily report/ });
    expect(
      strip.compareDocumentPosition(daily) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it.each(["projects", "topics", "contacts", "clients"])(
    "shows %s with Back and no directory",
    async (collection) => {
      await setup(`/t/tenant-northstar/library/wiki/${collection}`);
      expect(
        await screen.findByRole("link", { name: "Back to Wiki" }),
      ).toHaveAttribute("href", "/t/tenant-northstar/library/wiki?tab=wiki");
      expect(
        screen.queryByRole("navigation", { name: "Wiki directory" }),
      ).toBeNull();
      expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    },
  );
  it("locks a collection through opening files until Back to Wiki", async () => {
    const { router } = await setup("/t/tenant-northstar/documents/beta");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    expect(within(files).queryByRole("link", { name: "Home" })).toBeNull();
    fireEvent.click(await within(files).findByRole("link", { name: "alpha" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/documents\/alpha$/),
    );
    expect(
      screen.queryByRole("navigation", { name: "Wiki directory" }),
    ).toBeNull();
    expect(
      screen.getByRole("navigation", { name: "Projects files" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to Wiki" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/t/tenant-northstar/library/wiki",
      ),
    );
    expect(router.state.location.search).toBe("?tab=wiki");
    expect(
      screen.queryByRole("complementary", { name: "Wiki sidebar" }),
    ).toBeNull();
  });
  it("lists the open page's own collection after following a link", async () => {
    // A Session page sits outside the collections, so the root directory shows.
    const { router } = await setup(
      "/t/tenant-northstar/documents/alpha",
      undefined,
      { alpha: "sessions/2026-10-12/alpha.md" },
    );
    const directory = await screen.findByRole("navigation", {
      name: "Wiki directory",
    });
    fireEvent.click(within(directory).getByRole("link", { name: "Topics" }));
    // A link in a Topic then opens a Project page.
    await router.navigate("/t/tenant-northstar/documents/beta");
    const projects = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    expect(within(projects).getByRole("link", { name: "beta" })).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Topics files" }),
    ).toBeNull();
  });
  it("persists Keep/Hide locally without deleting Documents and offers inline Undo", async () => {
    const { runtime, unmount, pages } = await setup(
      "/t/tenant-northstar/documents/alpha",
    );
    const keep = await screen.findByRole("button", { name: "Keep alpha" });
    await waitFor(() => expect(keep).toBeEnabled());
    fireEvent.click(keep);
    fireEvent.click(screen.getByRole("button", { name: "Hide beta" }));
    const files = screen.getByRole("navigation", { name: "Projects files" });
    expect(within(files).getByRole("link", { name: "alpha" })).toBeVisible();
    expect(within(files).queryByText("Kept")).toBeNull();
    expect(
      within(files).queryByRole("button", { name: "Keep alpha" }),
    ).toBeNull();
    expect(
      within(files).queryByRole("button", { name: "Hide alpha" }),
    ).toBeNull();
    expect(within(files).queryByRole("link", { name: "beta" })).toBeNull();
    const status = within(files).getByRole("status");
    expect(status).toHaveTextContent("Hidden beta");
    expect(within(status).getByRole("button", { name: "Undo" })).toBeVisible();
    expect(
      runtime.server.requestsTo("DELETE", "/v0/documents/{documentId}"),
    ).toHaveLength(0);
    expect(pages).toHaveLength(2);
    unmount();
    await setup("/t/tenant-northstar/documents/alpha");
    const restored = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    expect(
      await within(restored).findByRole("link", { name: "alpha" }),
    ).toBeVisible();
    expect(within(restored).queryByText("Kept")).toBeNull();
    expect(
      within(restored).queryByRole("button", { name: "Keep alpha" }),
    ).toBeNull();
    expect(
      within(restored).queryByRole("button", { name: "Hide alpha" }),
    ).toBeNull();
    expect(
      within(
        screen.getByRole("navigation", { name: "Projects files" }),
      ).queryByRole("link", { name: "beta" }),
    ).toBeNull();
  });
  it("restores a hidden Wiki page immediately when clicking Undo", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const hideBeta = await screen.findByRole("button", { name: "Hide beta" });
    await waitFor(() => expect(hideBeta).toBeEnabled());
    fireEvent.click(hideBeta);

    const files = screen.getByRole("navigation", { name: "Projects files" });
    expect(within(files).queryByRole("link", { name: "beta" })).toBeNull();
    const status = within(files).getByRole("status");
    expect(status).toHaveTextContent("Hidden beta");

    fireEvent.click(within(status).getByRole("button", { name: "Undo" }));
    expect(within(files).getByRole("link", { name: "beta" })).toBeVisible();
    expect(within(files).queryByRole("status")).toBeNull();
  });
  it("filters the open collection's files and highlights the match", async () => {
    const { runtime } = await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    expect(
      await within(files).findByRole("link", { name: "alpha" }),
    ).toBeVisible();

    fireEvent.change(
      within(files).getByRole("searchbox", { name: "Filter Projects" }),
      { target: { value: "BET" } },
    );

    expect(within(files).queryByRole("link", { name: "alpha" })).toBeNull();
    const beta = within(files).getByRole("link", { name: "beta" });
    expect(within(beta).getByText("bet").tagName).toBe("MARK");
    expect(
      runtime.server.requestsTo(
        "GET",
        "/v0/tenants/{tenantId}/personal-wiki/documents",
      ),
    ).toHaveLength(1);
  });
  it("needs every word in the title and says when nothing matches", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });

    fireEvent.change(filter, { target: { value: "alpha beta" } });

    expect(within(files).queryAllByRole("link")).toHaveLength(0);
    expect(
      within(files).getByText("No projects match “alpha beta”."),
    ).toBeVisible();
  });
  it("keeps the open page selected and restores the files when cleared", async () => {
    const { router } = await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });

    fireEvent.change(filter, { target: { value: "alpha" } });
    expect(within(files).getByRole("link", { name: "alpha" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(files).queryByRole("link", { name: "beta" })).toBeNull();
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/documents/alpha",
    );

    fireEvent.change(filter, { target: { value: "beta" } });
    fireEvent.click(within(files).getByRole("link", { name: "beta" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/t/tenant-northstar/documents/beta",
      ),
    );
    expect(within(files).getByRole("link", { name: "beta" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(
      within(files).getByRole("button", { name: "Clear Projects filter" }),
    );
    expect(filter).toHaveValue("");
    expect(
      await within(files).findByRole("link", { name: "alpha" }),
    ).toBeVisible();
  });
  it("starts another collection from its full list", async () => {
    const { router } = await setup(
      "/t/tenant-northstar/documents/alpha",
      undefined,
      { beta: "topics/beta.md" },
    );
    const projects = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    expect(
      await within(projects).findByRole("link", { name: "alpha" }),
    ).toBeVisible();
    fireEvent.change(
      within(projects).getByRole("searchbox", { name: "Filter Projects" }),
      { target: { value: "alpha" } },
    );

    await router.navigate("/t/tenant-northstar/documents/beta");

    const topics = await screen.findByRole("navigation", {
      name: "Topics files",
    });
    expect(
      await within(topics).findByRole("link", { name: "beta" }),
    ).toBeVisible();
    expect(
      within(topics).getByRole("searchbox", { name: "Filter Topics" }),
    ).toHaveValue("");
  });
  it("keeps the filter out of browser storage", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    expect(
      await within(files).findByRole("link", { name: "alpha" }),
    ).toBeVisible();
    const before = Object.entries(window.localStorage).sort();
    fireEvent.change(
      within(files).getByRole("searchbox", { name: "Filter Projects" }),
      { target: { value: "beta" } },
    );

    expect(within(files).getByRole("link", { name: "beta" })).toBeVisible();
    expect(Object.entries(window.localStorage).sort()).toEqual(before);
  });
  it("opens and focuses the filter with /", async () => {
    const { router, runtime } = await setup(
      "/t/tenant-northstar/documents/alpha",
    );
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });
    expect(filter).not.toHaveFocus();

    expect(fireEvent.keyDown(document.body, { key: "/" })).toBe(false);

    expect(filter).toHaveFocus();
    fireEvent.change(filter, { target: { value: "BET" } });
    expect(within(files).queryByRole("link", { name: "alpha" })).toBeNull();
    expect(within(files).getByRole("link", { name: "beta" })).toBeVisible();
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/documents/alpha",
    );
    expect(
      runtime.server.requestsTo(
        "GET",
        "/v0/tenants/{tenantId}/personal-wiki/documents",
      ),
    ).toHaveLength(1);
  });
  it("leaves / to the filter once it has focus", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });
    filter.focus();

    expect(fireEvent.keyDown(filter, { key: "/" })).toBe(true);

    expect(filter).toHaveFocus();
  });
  it("ignores / typed into another field", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();

    expect(fireEvent.keyDown(elsewhere, { key: "/" })).toBe(true);

    elsewhere.remove();
    expect(filter).not.toHaveFocus();
  });
  it("ignores / during an IME composition", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });
    const composing = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "/",
    });
    Object.defineProperty(composing, "isComposing", { value: true });

    window.dispatchEvent(composing);

    expect(composing.defaultPrevented).toBe(false);
    expect(filter).not.toHaveFocus();
  });
  it("ignores / with a modifier held", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });

    expect(fireEvent.keyDown(document.body, { key: "/", metaKey: true })).toBe(
      true,
    );

    expect(filter).not.toHaveFocus();
  });
  it("ignores / while a dialog is open", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.append(inside);
    document.body.append(dialog);

    expect(fireEvent.keyDown(inside, { key: "/" })).toBe(true);

    dialog.remove();
    expect(filter).not.toHaveFocus();
  });
  it("clears the filter and leaves the field on Escape", async () => {
    await setup("/t/tenant-northstar/documents/alpha");
    const files = await screen.findByRole("navigation", {
      name: "Projects files",
    });
    const filter = await within(files).findByRole("searchbox", {
      name: "Filter Projects",
    });
    fireEvent.change(filter, { target: { value: "BET" } });
    expect(within(files).queryByRole("link", { name: "alpha" })).toBeNull();

    expect(fireEvent.keyDown(filter, { key: "Escape" })).toBe(false);

    expect(filter).toHaveValue("");
    expect(filter).not.toHaveFocus();
    expect(
      await within(files).findByRole("link", { name: "alpha" }),
    ).toBeVisible();
  });
  it("filters hidden graph nodes and all their links without mutating the graph", () => {
    const result = filterWikiGraph(graph, {
      [wikiPageKey("projects/alpha.md")]: "delete",
    });
    expect(result.nodes.map((node) => node.id)).toEqual(["projects/beta"]);
    expect(result.edges).toEqual([]);
    expect(result.nodes[0]!.links).toEqual([]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});
