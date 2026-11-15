import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import type { TestRouteHandler } from "@/test/teamhub-test-server";
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
});
