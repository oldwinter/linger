import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

import { RoomAddDocumentPage } from "./room-add-document-page";

function renderPage() {
  const runtime = createTestTeamHubRuntime();
  const base = runtime.seed.documents.get("document-meeting-transcript");
  if (!base) throw new Error("missing seed document");
  const launch: TeamHubDocument = {
    ...base,
    from: [],
    id: "document-launch-notes",
    title: "Launch notes",
    updated_at: "2026-11-14T03:00:00Z",
  };
  const wikiOnly: TeamHubDocument = {
    ...base,
    capabilities: { ...base.capabilities, manage: false },
    from: [{ binding_kind: "wiki_source", context_id: "tenant-northstar" }],
    id: "document-wiki-only",
    owner: { ...base.owner, id: "actor-someone-else" },
    title: "Wiki only page",
  };
  runtime.seed.documents.set(launch.id, launch);
  runtime.seed.documents.set(wikiOnly.id, wikiOnly);
  const bind = vi.fn<TestRouteHandler>(({ params }) => ({
    id: params.documentId,
  }));
  runtime.server.on("PUT", "/v0/rooms/{roomId}/documents/{documentId}", bind);
  const router = createMemoryRouter(
    [
      {
        element: <RoomAddDocumentPage />,
        path: "/t/:tenantId/rooms/:roomId/add-document",
      },
    ],
    {
      initialEntries: ["/t/tenant-northstar/rooms/room-all/add-document"],
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
  return bind;
}

describe("RoomAddDocumentPage", () => {
  it("binds a chosen document into the room and leaves a wiki-only page out", async () => {
    const bind = renderPage();
    expect(
      await screen.findByRole("checkbox", { name: "Launch notes" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: "Wiki only page" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Already in this room" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Launch notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to this room" }));
    expect(
      await screen.findByText("Added 1 document to this room."),
    ).toBeVisible();
    expect(bind).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("checkbox", { name: "Launch notes" })).toBeNull();
    expect(screen.getByText("Launch notes")).toBeVisible();
  });

  it("filters available documents live and places Back to room above the h2 heading", async () => {
    const runtime = createTestTeamHubRuntime();
    const base = runtime.seed.documents.get("document-meeting-transcript")!;
    runtime.seed.documents.set("doc-launch", {
      ...base,
      from: [],
      id: "doc-launch",
      title: "Launch notes",
    });
    runtime.seed.documents.set("doc-budget", {
      ...base,
      from: [],
      id: "doc-budget",
      title: "Q4 Budget",
    });
    const router = createMemoryRouter(
      [
        {
          element: <RoomAddDocumentPage />,
          path: "/t/:tenantId/rooms/:roomId/add-document",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/add-document"] },
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

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Add a document",
    });
    expect(screen.queryByRole("main")).toBeNull();
    const back = screen.getByRole("link", { name: "Back to room" });
    expect(
      back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const search = await screen.findByRole("searchbox", {
      name: "Filter documents",
    });
    fireEvent.change(search, { target: { value: "budget" } });
    expect(screen.getByRole("checkbox", { name: "Q4 Budget" })).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Launch notes" })).toBeNull();

    fireEvent.change(search, { target: { value: "nonexistent" } });
    expect(screen.getByText("No matching documents.")).toBeVisible();
  });

  it("syncs succeeded documents on partial failure and retries only the failed document", async () => {
    const runtime = createTestTeamHubRuntime();
    const base = runtime.seed.documents.get("document-meeting-transcript")!;
    runtime.seed.documents.set("doc-first", {
      ...base,
      from: [],
      id: "doc-first",
      title: "First doc",
    });
    runtime.seed.documents.set("doc-second", {
      ...base,
      from: [],
      id: "doc-second",
      title: "Second doc",
    });
    let failSecond = true;
    const bind = vi.fn<TestRouteHandler>(({ params }) => {
      if (params.documentId === "doc-second" && failSecond) {
        failSecond = false;
        return teamHubErrorResponse(
          503,
          "BIND_FAILED",
          "Could not bind second.",
        );
      }
      return { id: params.documentId };
    });
    runtime.server.on("PUT", "/v0/rooms/{roomId}/documents/{documentId}", bind);
    const router = createMemoryRouter(
      [
        {
          element: <RoomAddDocumentPage />,
          path: "/t/:tenantId/rooms/:roomId/add-document",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/add-document"] },
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

    fireEvent.click(await screen.findByRole("checkbox", { name: "First doc" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Second doc" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to this room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not bind second.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add to this room" }),
      ).toBeEnabled(),
    );
    // First doc already moved to Already in this room; Second doc stays checked.
    expect(screen.queryByRole("checkbox", { name: "First doc" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Second doc" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Add to this room" }));
    expect(
      await screen.findByText("Added 2 documents to this room."),
    ).toBeVisible();
    expect(bind.mock.calls.map(([req]) => req.params.documentId)).toEqual([
      "doc-first",
      "doc-second",
      "doc-second",
    ]);
  });

  it("offers Retry when loading documents fails", async () => {
    const runtime = createTestTeamHubRuntime();
    let fail = true;
    runtime.server.on("GET", "/v0/library/documents", () => {
      if (fail) {
        fail = false;
        return teamHubErrorResponse(503, "DOCS_UNAVAILABLE");
      }
      return { items: [], page: { has_more: false } };
    });
    const router = createMemoryRouter(
      [
        {
          element: <RoomAddDocumentPage />,
          path: "/t/:tenantId/rooms/:roomId/add-document",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/add-document"] },
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Documents could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No documents left to add.")).toBeVisible();
  });
});
