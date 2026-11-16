import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";

import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";
import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";

import { WikiConnectionsPanel } from "./wiki-connections-panel";
import { writeRecentWikiPages } from "./recent-wiki-pages";
import { serveWikiDocuments, wikiDocument } from "./wiki.test-support";

function graphNode(
  id: string,
  title: string,
  links: string[] = [],
  backlinks: string[] = [],
): WikiGraphNode {
  return {
    backlinks,
    body: "",
    category: "Project",
    description: "",
    id,
    links,
    size: 1,
    tags: [],
    title,
  };
}

function serveGraph(runtime: TestTeamHubRuntime, nodes: WikiGraphNode[]) {
  return vi
    .spyOn(runtime.client, "getPersonalKnowledgeGraphVisualization")
    .mockResolvedValue(
      `const graph=${JSON.stringify({ edges: [], nodes, types: [] })};\n`,
    );
}

function renderPanel(runtime: TestTeamHubRuntime, pageKey: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <WikiConnectionsPanel pageKey={pageKey} tenantId="tenant-northstar" />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(
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
}

function pageDocument(id: string, pageKey: string) {
  const document = wikiDocument(id, `${id}.md`, "wiki_page");
  document.from[0]!.page_key = pageKey;
  return document;
}

it("lists both link directions and opens each page", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [
      pageDocument("contact-bob", "people/bob.md"),
      pageDocument("topic-gamma", "topics/gamma.md"),
    ],
    page: { has_more: false },
  });
  serveGraph(runtime, [
    graphNode("projects/alpha", "Alpha", ["people/bob"], ["topics/gamma"]),
    graphNode("people/bob", "Bob"),
    graphNode("topics/gamma", "Gamma"),
  ]);
  renderPanel(runtime, "projects/alpha");

  expect(await screen.findByRole("link", { name: "Bob" })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/contact-bob",
  );
  expect(screen.getByRole("link", { name: "Gamma" })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/topic-gamma",
  );
  expect(screen.getByRole("region", { name: "Links to" })).toContainElement(
    screen.getByRole("link", { name: "Bob" }),
  );
  expect(screen.getByRole("region", { name: "Linked from" })).toContainElement(
    screen.getByRole("link", { name: "Gamma" }),
  );
});

it("shows the words of the one page that points back", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [
      pageDocument("project-alpha", "projects/alpha.md"),
      pageDocument("person-maya", "people/maya.md"),
    ],
    page: { has_more: false },
  });
  const maya = graphNode("people/maya", "Maya", ["projects/alpha"]);
  maya.body = "Maya keeps the notes.";
  const alpha = graphNode("projects/alpha", "Alpha", ["people/maya"]);
  serveGraph(runtime, [alpha, maya]);
  renderPanel(runtime, "projects/alpha");

  const back = await screen.findByRole("region", {
    name: "The page that points back",
  });
  expect(back).toHaveTextContent("Maya keeps the notes.");
  expect(within(back).getByRole("link", { name: "Maya" })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/person-maya",
  );
});

it("hides the section when the graph is empty", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [pageDocument("project-alpha", "projects/alpha.md")],
    page: { has_more: false },
  });
  const graph = serveGraph(runtime, []);
  renderPanel(runtime, "projects/alpha");

  await waitFor(() => expect(graph).toHaveBeenCalledOnce());
  await act(async () => undefined);
  expect(screen.queryByText("Connections")).not.toBeInTheDocument();
});

it("hides the section when the page has no graph node", async () => {
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [pageDocument("project-alpha", "projects/alpha.md")],
    page: { has_more: false },
  });
  const graph = serveGraph(runtime, [
    graphNode("people/bob", "Bob"),
    graphNode("topics/gamma", "Gamma"),
  ]);
  renderPanel(runtime, "projects/alpha");

  await waitFor(() => expect(graph).toHaveBeenCalledOnce());
  await act(async () => undefined);
  expect(screen.queryByText("Connections")).not.toBeInTheDocument();
});

it("says how the page you left reaches this one", async () => {
  localStorage.clear();
  const runtime = createTestTeamHubRuntime();
  serveWikiDocuments(runtime).mockResolvedValue({
    items: [
      pageDocument("doc-monday", "meetings/monday.md"),
      pageDocument("doc-maya", "people/maya.md"),
      pageDocument("doc-alpha", "projects/alpha.md"),
    ],
    page: { has_more: false },
  });
  serveGraph(runtime, [
    graphNode("meetings/monday", "Monday", ["people/maya"]),
    graphNode("people/maya", "Maya", ["projects/alpha"]),
    graphNode("projects/alpha", "Alpha"),
  ]);
  writeRecentWikiPages("account-jenny", "tenant-northstar", [
    {
      id: "doc-alpha",
      name: "Alpha",
      openedAt: "2026-11-16T03:00:00.000Z",
      path: "/t/tenant-northstar/documents/doc-alpha",
    },
    {
      id: "doc-monday",
      name: "Monday",
      openedAt: "2026-11-16T02:00:00.000Z",
      path: "/t/tenant-northstar/documents/doc-monday",
    },
  ]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(teamHubIdentityQueryKey, {
    account: {
      created_at: "2026-07-24T09:00:00Z",
      email: "jenny@northstar.example",
      id: "account-jenny",
    },
    actors: [],
  });
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <WikiConnectionsPanel
          pageKey="projects/alpha"
          tenantId="tenant-northstar"
        />
      ),
    },
  ]);
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText(
      (_text, element) =>
        element?.tagName === "P" &&
        (element.textContent ?? "").includes(
          "Monday reaches this page through Maya",
        ),
    ),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Maya" })).toHaveAttribute(
    "href",
    "/t/tenant-northstar/documents/doc-maya",
  );
});
