import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";

import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";

import { WikiConnectionsPanel } from "./wiki-connections-panel";
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
