import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { RoomDocumentCollaborationSession } from "./room-document-collaboration";
import type { RoomDocumentSaveSnapshot } from "./room-document-save-tracker";
import type { UnifiedDocumentPageModel } from "./use-unified-document-page-model";
import { UnifiedDocumentBody } from "./unified-document-body";

vi.mock("./room-document-blocknote-editor-loader", () => ({
  RoomDocumentBlockNoteEditor: () => <div data-testid="mock-editor" />,
}));

function createMockSession(
  initial: RoomDocumentSaveSnapshot,
  readOnly = false,
) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const doc = new Y.Doc();
  const session: RoomDocumentCollaborationSession = {
    awareness: null,
    destroy: async () => {
      doc.destroy();
    },
    document: doc,
    getSaveSnapshot: () => snapshot,
    readOnly,
    subscribeSaveState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    user: { actorId: "actor-1", color: "#000000", name: "Owner" },
  };
  return {
    session,
    setSnapshot(next: RoomDocumentSaveSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

function renderBody(session: RoomDocumentCollaborationSession) {
  const queryClient = new QueryClient();
  const model = {
    actor: {
      display_name: "Owner",
      id: "actor-1",
      kind: "human",
      tenant_id: "tenant-1",
    },
    autoFocusTitle: false,
    canRetryLoad: false,
    canvasTarget: undefined,
    client: {} as UnifiedDocumentPageModel["client"],
    commentsOpen: false,
    commentsPortalTarget: null,
    consumeAutoFocusTitle: vi.fn(),
    currentVersion: undefined,
    document: {
      capabilities: { comment: true, write: true },
      format: "blocknote",
      from: [],
      id: "doc-1",
      owner: { display_name: "Owner", id: "actor-1", kind: "human" },
      representation_format: "blocknote",
      status: "active",
      title: "Draft notes",
    },
    documentActionError: null,
    editorRef: { current: null },
    error: null,
    exportError: null,
    isEditing: true,
    onCanvasSentChange: vi.fn(),
    onCanvasTargetChange: vi.fn(),
    queryClient,
    resyncSession: vi.fn(),
    retryLoad: vi.fn(),
    roomId: "room-1",
    session,
    setCommentsOpen: vi.fn(),
    setHeadings: vi.fn(),
    tenantId: "tenant-1",
  } as unknown as UnifiedDocumentPageModel;

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UnifiedDocumentBody
          documentContentRef={{ current: null }}
          isWikiPage={false}
          knowledgeTitle={undefined}
          model={model}
          wikiLinks={{ error: null, openLink: vi.fn(), pending: false }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("UnifiedDocumentBody beforeunload protection", () => {
  it("warns before closing the tab while local or offline edits are unsaved and stops once saved or unmounted", () => {
    const { session, setSnapshot } = createMockSession({
      canEdit: true,
      durableSequence: 1,
      status: "Saved",
    });
    const view = renderBody(session);

    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    act(() => {
      setSnapshot({
        canEdit: true,
        durableSequence: 1,
        status: "Local pending",
      });
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => {
      setSnapshot({
        canEdit: true,
        durableSequence: 1,
        status: "Offline pending",
      });
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => {
      setSnapshot({
        canEdit: false,
        durableSequence: 1,
        protocolError: "durable_save_failed",
        status: "Synced",
      });
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => {
      setSnapshot({
        canEdit: true,
        durableSequence: 2,
        status: "Saved",
      });
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    act(() => {
      setSnapshot({
        canEdit: true,
        durableSequence: 2,
        status: "Offline pending",
      });
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    view.unmount();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("does not warn for read-only sessions", () => {
    const { session } = createMockSession(
      { canEdit: false, status: "Offline pending" },
      true,
    );
    renderBody(session);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});
