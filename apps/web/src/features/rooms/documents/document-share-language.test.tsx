import { useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryLayout } from "@/features/library/library-layout";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { DocumentLinkPolicy } from "@/features/teamhub/teamhub-document-links";
import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import {
  createDocumentTestRuntime,
  seedNativeDocument,
} from "@/test/document-scenarios";

import { DocumentLinkSharing } from "./document-link-sharing";
import { UnifiedDocumentPage } from "./room-document-surface";

const share = zhCN.documentShare;

vi.mock("@/features/rooms/files/pdf-preview-adapter-loader", () => ({
  PdfPreviewAdapterLoader: () => <div>PDF preview</div>,
}));

vi.mock("./room-document-collaboration", async (importOriginal) => {
  const { openLocalDocumentSession } =
    await import("@/test/local-document-session");
  return {
    ...(await importOriginal<typeof import("./room-document-collaboration")>()),
    openRoomDocumentSession: vi.fn(openLocalDocumentSession),
  };
});

vi.mock("./room-document-blocknote-editor-loader", () => ({
  RoomDocumentBlockNoteEditor: ({
    onCanvasTargetChange,
  }: {
    onCanvasTargetChange?: (target?: string) => void;
  }) => {
    // Like the real editor, report the body's canvas target once mounted.
    useLayoutEffect(
      () => onCanvasTargetChange?.(undefined),
      [onCanvasTargetChange],
    );
    return <div className="bn-editor">Room BlockNote editor</div>;
  },
}));

function renderDocumentPage(runtime: TeamHubRuntime, documentId: string) {
  const router = createMemoryRouter(
    [
      {
        element: <LibraryLayout />,
        children: [
          {
            element: <UnifiedDocumentPage />,
            path: "/t/:tenantId/documents/:documentId",
          },
        ],
      },
    ],
    { initialEntries: [`/t/tenant-northstar/documents/${documentId}`] },
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

describe("Document sharing in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("words the share dialog in Chinese and marks the removals", async () => {
    await setLanguage("zh-CN");
    const runtime = createDocumentTestRuntime();
    const document = seedNativeDocument(runtime, "language-share-document");
    runtime.server.on(
      "GET",
      "/v0/documents/{documentId}/collaborators",
      () => ({
        caller_content_role: "owner",
        can_manage_collaborators: true,
        management_capabilities: {
          can_change_ownership: true,
          can_update_external_policy: true,
          can_update_link_policy: true,
        },
        schema_version: 2,
        sources: [
          {
            label: "Alex",
            source: {
              created_at: "2026-08-29T08:00:00Z",
              grantor_actor_id: document.owner.id,
              provenance: { kind: "direct_grant", schema_version: 2 },
              role: "editor",
              schema_version: 2,
              source_id: "direct-alex",
              source_kind: "direct",
              source_version: 3,
              status: "active",
              target: { id: "actor-alex", kind: "agent" },
              updated_at: "2026-08-29T08:00:00Z",
            },
          },
          {
            label: "Launch Room",
            source: {
              created_at: "2026-08-29T08:00:00Z",
              provenance: {
                binding_kind: "room",
                context_id: "room-launch",
                kind: "context_binding",
                schema_version: 2,
              },
              role: "editor",
              schema_version: 2,
              source_id: "room-binding-launch",
              source_kind: "context",
              source_version: 7,
              status: "active",
              updated_at: "2026-08-29T08:00:00Z",
            },
          },
        ],
      }),
    );

    renderDocumentPage(runtime, document.id);
    fireEvent.click(
      await screen.findByRole("button", { name: zhCN.documentPage.share }),
    );

    expect(
      await screen.findByRole("dialog", { name: share.shareDocument }),
    ).toBeVisible();
    expect(
      await screen.findByText(
        share.yourAccess.replace("{role}", zhCN.library.roleOwner),
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: share.sharedWithRooms }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: share.removeFromRoom }),
    ).toHaveAttribute("data-voice-risk", "never");
    expect(
      screen.getByRole("button", { name: zhCN.library.copyLink }),
    ).toBeVisible();

    const manage = screen.getByRole("button", {
      name: share.manageActiveCollaborators.replace("{count}", "2"),
    });
    expect(manage).toHaveTextContent(share.activeCount.replace("{count}", "2"));
    fireEvent.click(manage);
    expect(
      screen.getByRole("heading", { name: share.manageCollaborators }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: share.backToShare }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", {
        name: share.permission.replace("{label}", "Alex"),
      }),
    ).toBeVisible();
  });

  it("words link sharing in Chinese and marks Reset link as a decision", async () => {
    await setLanguage("zh-CN");
    const policy: DocumentLinkPolicy = {
      document_id: "doc-1",
      id: "link-1",
      role: "viewer",
      status: "active",
      version: 1,
    };
    const client = {
      documentLinks: {
        get: vi.fn(async () => policy),
        revoke: vi.fn(),
        set: vi.fn(),
      },
    } as unknown as TeamHubClient;

    render(
      <QueryClientProvider client={new QueryClient()}>
        <DocumentLinkSharing client={client} documentId="doc-1" />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: share.anyoneWithLink }),
    ).toBeVisible();
    const access = screen.getByRole("combobox", { name: share.linkAccess });
    await waitFor(() => expect(access).toBeEnabled());
    expect(access).toHaveTextContent(share.canView);
    expect(
      screen.getByRole("button", { name: share.resetLink }),
    ).toHaveAttribute("data-voice-risk", "confirm");
  });
});
