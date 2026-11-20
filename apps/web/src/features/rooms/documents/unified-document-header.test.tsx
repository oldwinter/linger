import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { UnifiedDocumentPageHeader } from "./unified-document-header";
import type { UnifiedDocumentPageModel } from "./use-unified-document-page-model";

const owner = {
  display_name: "Jenny Bin",
  id: "actor-jenny",
  kind: "human" as const,
  tenant_id: "tenant-northstar",
};

function baseDocument(
  overrides: Partial<TeamHubDocument> = {},
): TeamHubDocument {
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
    created_at: "2026-10-01T09:00:00Z",
    creator: owner,
    current_version: null,
    draft_capability: "write",
    format: "blocknote",
    from: [],
    id: "doc-1",
    owner,
    representation_format: "markdown",
    status: "active",
    tenant_id: "tenant-northstar",
    title: "launch-plan",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

function renderHeader(document: TeamHubDocument, isWikiPage = false) {
  const runtime = createTestTeamHubRuntime();
  const model = {
    actor: undefined,
    canvasSent: false,
    canvasTarget: undefined,
    client: runtime.client,
    commentsOpen: false,
    document,
    documentId: document.id,
    duplicateDocument: vi.fn(),
    duplicatePending: false,
    exportDocument: vi.fn(),
    exportPending: false,
    isEditing: false,
    isSharedDocument: false,
    resyncSession: vi.fn(),
    roomId: undefined,
    session: null,
    setCommentsOpen: vi.fn(),
    setHeadings: vi.fn(),
    setHistoryOpen: vi.fn(),
    setIsEditing: vi.fn(),
    setShareOpen: vi.fn(),
    setTocOpen: vi.fn(),
    setTrashConfirmOpen: vi.fn(),
    setTreeOpen: vi.fn(),
    sharedTree: { data: { items: [] } },
    sidebar: false,
    tenantId: "tenant-northstar",
    tocOpen: false,
    tree: { data: { items: [] } },
    treeOpen: false,
  } as unknown as UnifiedDocumentPageModel;

  const router = createMemoryRouter(
    [
      {
        element: (
          <UnifiedDocumentPageHeader
            documentContentRef={createRef<HTMLDivElement>()}
            isWikiPage={isWikiPage}
            model={model}
          />
        ),
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
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
}

describe("UnifiedDocumentPageHeader Mark this moment gating", () => {
  it("shows Mark this moment for writable native collaborative documents", () => {
    renderHeader(baseDocument());
    expect(
      screen.getByRole("link", { name: "Mark this moment" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/documents/doc-1/mark");
  });

  it("hides Mark this moment for uploaded non-native files even when writable", () => {
    renderHeader(
      baseDocument({
        can_edit_native_content: false,
        draft_capability: "none",
        format: "binary",
        representation_format: "binary",
        title: "deck.pdf",
      }),
    );
    expect(screen.queryByRole("link", { name: "Mark this moment" })).toBeNull();
  });

  it("hides Mark this moment for HTML documents, read-only drafts, and Wiki pages", () => {
    const htmlView = renderHeader(
      baseDocument({
        can_edit_native_content: false,
        draft_capability: "none",
        representation_format: "html",
      }),
    );
    expect(screen.queryByRole("link", { name: "Mark this moment" })).toBeNull();
    void htmlView;
  });

  it("hides Mark this moment on Wiki pages", () => {
    renderHeader(baseDocument(), true);
    expect(screen.queryByRole("link", { name: "Mark this moment" })).toBeNull();
  });

  it("hides Mark this moment when draft capability is read-only", () => {
    renderHeader(baseDocument({ draft_capability: "read" }));
    expect(screen.queryByRole("link", { name: "Mark this moment" })).toBeNull();
  });
});
