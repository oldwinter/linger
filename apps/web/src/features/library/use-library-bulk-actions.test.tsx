import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createHttpTeamHubClient } from "@/features/teamhub/teamhub-client";
import type {
  TeamHubDocumentPlacementNode,
  TeamHubDocumentTreeSummary,
} from "@/features/teamhub/teamhub-types";
import {
  teamHubErrorResponse,
  TeamHubTestServer,
} from "@/test/teamhub-test-server";

import { useLibraryBulkActions } from "./use-library-bulk-actions";

const tenantId = "tenant-1";

function treeDocument(
  id: string,
  title: string,
  overrides: Partial<TeamHubDocumentTreeSummary> = {},
): TeamHubDocumentTreeSummary {
  return {
    can_edit_native_content: true,
    capabilities: {
      comment: true,
      delete: true,
      duplicate: true,
      export: true,
      manage: true,
      read: true,
      use_as_context: true,
      write: true,
    },
    format: "blocknote",
    id,
    owner: {
      display_name: "Alice",
      id: "actor-1",
      kind: "human",
      tenant_id: tenantId,
    },
    representation_format: "markdown",
    status: "active",
    title,
    updated_at: "2026-10-09T08:00:00.000Z",
    ...overrides,
  };
}

function placement(
  document: TeamHubDocumentTreeSummary,
): TeamHubDocumentPlacementNode {
  return {
    created_at: document.updated_at,
    document,
    document_id: document.id,
    id: `placement-${document.id}`,
    node_kind: "document",
    sort_key: document.id,
    updated_at: document.updated_at,
  };
}

function setup(
  routes: (server: TeamHubTestServer) => void,
  documents: TeamHubDocumentTreeSummary[],
) {
  const server = new TeamHubTestServer();
  routes(server);
  const client = createHttpTeamHubClient({
    fetchRequest: server.fetch,
    onAuthenticationRequired: () => undefined,
  });
  const onChanged = vi.fn(async () => undefined);
  const { result } = renderHook(() =>
    useLibraryBulkActions({
      client,
      documents,
      items: documents.map(placement),
      onChanged,
      resetKey: "owned:",
      tenantId,
    }),
  );
  return { onChanged, result };
}

describe("useLibraryBulkActions", () => {
  it("moves every selected document through its placement and rereads once", async () => {
    const scripts = treeDocument("document-1", "Alpha");
    const notes = treeDocument("document-2", "Bravo");
    const movePlacement = vi.fn(
      ({ params }: { params: Record<string, string> }) => ({
        ...placement(scripts),
        id: params.placementId,
        parent_id: "folder-1",
      }),
    );
    const { onChanged, result } = setup(
      (server) =>
        server.on(
          "PATCH",
          "/v0/tenants/{tenantId}/me/document-placements/{placementId}",
          movePlacement,
        ),
      [scripts, notes],
    );

    act(() => result.current.toggle(scripts.id));
    act(() => result.current.toggle(notes.id));
    expect(result.current.count).toBe(2);

    act(() => result.current.beginMove());
    expect(result.current.moving).toHaveLength(2);
    await act(async () => {
      await result.current.moveTo("folder-1");
    });

    expect(movePlacement).toHaveBeenCalledTimes(2);
    expect(movePlacement).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { parent_id: "folder-1" },
        params: { placementId: "placement-document-1", tenantId },
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(result.current.selectedDocumentIds.size).toBe(0);
    expect(result.current.outcome).toEqual({
      failed: 0,
      message: "Moved 2 documents.",
    });
  });

  it("keeps the failed documents selected and names them", async () => {
    const scripts = treeDocument("document-1", "Alpha");
    const notes = treeDocument("document-2", "Bravo");
    const { onChanged, result } = setup(
      (server) =>
        server.on(
          "PATCH",
          "/v0/tenants/{tenantId}/me/document-placements/{placementId}",
          ({ params }) =>
            params.placementId === "placement-document-2"
              ? teamHubErrorResponse(503, "PLACEMENT_UNAVAILABLE")
              : {
                  ...placement(notes),
                  id: params.placementId,
                  parent_id: "folder-1",
                },
        ),
      [scripts, notes],
    );

    act(() => result.current.toggle(scripts.id));
    act(() => result.current.toggle(notes.id));
    act(() => result.current.beginMove());
    await act(async () => {
      await result.current.moveTo("folder-1");
    });

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect([...result.current.selectedDocumentIds]).toEqual([notes.id]);
    expect(result.current.outcome).toEqual({
      failed: 1,
      message: "Moved 1 of 2 documents. Failed: Bravo.",
    });
  });

  it("trashes selected documents and reports the count", async () => {
    const scripts = treeDocument("document-1", "Alpha");
    const trash = vi.fn(() => undefined);
    const { result } = setup(
      (server) => server.on("DELETE", "/v0/documents/{documentId}", trash),
      [scripts],
    );

    act(() => result.current.toggle(scripts.id));
    expect(result.current.canTrash).toBe(true);
    act(() => result.current.beginTrash());
    await act(async () => {
      await result.current.trash();
    });

    expect(trash).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { documentId: "document-1" },
      }),
    );
    await waitFor(() =>
      expect(result.current.outcome).toEqual({
        failed: 0,
        message: "Moved to trash 1 document.",
      }),
    );
    expect(result.current.selectedDocumentIds.size).toBe(0);
  });

  it("starts a newly opened folder or view with an empty selection", () => {
    const alpha = treeDocument("document-1", "Alpha");
    const client = createHttpTeamHubClient({
      fetchRequest: new TeamHubTestServer().fetch,
      onAuthenticationRequired: () => undefined,
    });
    const { result, rerender } = renderHook(
      ({ resetKey }) =>
        useLibraryBulkActions({
          client,
          documents: [alpha],
          items: [placement(alpha)],
          onChanged: async () => undefined,
          resetKey,
          tenantId,
        }),
      { initialProps: { resetKey: "owned:" } },
    );

    act(() => result.current.toggle(alpha.id));
    expect(result.current.count).toBe(1);

    rerender({ resetKey: "owned:folder-1" });

    expect(result.current.count).toBe(0);
    expect(result.current.selectedDocumentIds.size).toBe(0);
  });

  it("does not offer a move for a document without a personal placement", () => {
    const shared = treeDocument("document-3", "Shared", {
      capabilities: {
        comment: true,
        delete: false,
        duplicate: true,
        export: true,
        manage: false,
        read: true,
        use_as_context: true,
        write: false,
      },
    });
    const { result } = renderHook(() => {
      const client = createHttpTeamHubClient({
        fetchRequest: new TeamHubTestServer().fetch,
        onAuthenticationRequired: () => undefined,
      });
      return useLibraryBulkActions({
        client,
        documents: [shared],
        items: [],
        onChanged: async () => undefined,
        resetKey: "owned:",
        tenantId,
      });
    });

    act(() => result.current.toggle(shared.id));

    expect(result.current.canMove).toBe(false);
    expect(result.current.canTrash).toBe(false);
  });
});
