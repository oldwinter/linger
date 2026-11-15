import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDocumentTestRuntime,
  seedRoomDocument,
} from "@/test/document-scenarios";
import {
  localDocumentMarkdown,
  openLocalDocumentSession,
} from "@/test/local-document-session";

import {
  RoomDocumentBlockNoteEditor,
  type RoomDocumentEditor,
} from "./room-document-blocknote-editor";

afterEach(() => {
  vi.useRealTimers();
});

let editorCount = 0;

describe("Room Document text count line", () => {
  it("shows the count and rewrites it after a change", async () => {
    const { surfaceEditorRef } = await renderEditor("Hello world");

    expect(await screen.findByText("2 words · 10 characters")).toBeVisible();

    insertParagraph(surfaceEditorRef, "Another line");

    expect(await screen.findByText("4 words · 21 characters")).toBeVisible();
  });

  it("collapses changes within the throttle interval into one count", async () => {
    const { surfaceEditorRef } = await renderEditor("Hello world");
    expect(await screen.findByText("2 words · 10 characters")).toBeVisible();
    vi.useFakeTimers();

    insertParagraph(surfaceEditorRef, "Another");
    insertParagraph(surfaceEditorRef, "Third");

    expect(screen.getByTestId("document-text-count")).toHaveTextContent(
      "3 words · 17 characters",
    );
    await act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId("document-text-count")).toHaveTextContent(
      "4 words · 22 characters",
    );
  });

  it("stays hidden for an empty Document", async () => {
    const { surfaceEditorRef } = await renderEditor("");

    await waitFor(() => expect(surfaceEditorRef.current).not.toBeNull());
    expect(screen.queryByTestId("document-text-count")).toBeNull();
  });

  it("stays hidden for a Document the person cannot edit", async () => {
    const { surfaceEditorRef } = await renderEditor("Hello world", false);

    await waitFor(() => expect(screen.getByText("Hello world")).toBeVisible());
    expect(surfaceEditorRef.current).not.toBeNull();
    expect(screen.queryByTestId("document-text-count")).toBeNull();
  });

  it("drops a pending recount when the editor unmounts", async () => {
    const { surfaceEditorRef, unmount } = await renderEditor("Hello world");
    expect(await screen.findByText("2 words · 10 characters")).toBeVisible();
    const editor = surfaceEditorRef.current!;
    vi.useFakeTimers();
    const exportMarkdown = vi.spyOn(editor, "blocksToMarkdownLossy");

    insertParagraph(surfaceEditorRef, "Another");
    insertParagraph(surfaceEditorRef, "Third");
    expect(exportMarkdown).toHaveBeenCalledTimes(1);

    unmount();
    await act(() => vi.advanceTimersByTime(1_000));

    expect(exportMarkdown).toHaveBeenCalledTimes(1);
  });
});

async function renderEditor(markdown: string, editable = true) {
  const runtime = createDocumentTestRuntime();
  const document = seedRoomDocument(
    runtime,
    `document-text-count-${++editorCount}`,
  );
  if (markdown) localDocumentMarkdown.set(document.id, markdown);
  const session = await openLocalDocumentSession({
    documentId: document.id,
    schemaVersion: 1,
    stateHashVersion: 1,
    user: { actorId: "human-jenny", name: "Jenny", color: "#336699" },
  });
  const surfaceEditorRef: { current: RoomDocumentEditor | null } = {
    current: null,
  };
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <RoomDocumentBlockNoteEditor
          client={runtime.client}
          canComment={false}
          currentActorId="human-jenny"
          documentId={document.id}
          editable={editable}
          session={session}
          surfaceEditorRef={surfaceEditorRef}
          tenantId="tenant-northstar"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, surfaceEditorRef };
}

function insertParagraph(
  surfaceEditorRef: { current: RoomDocumentEditor | null },
  text: string,
) {
  act(() => {
    const editor = surfaceEditorRef.current!;
    const blocks = editor.document;
    editor.insertBlocks(
      [{ type: "paragraph", content: text }],
      blocks[blocks.length - 1]!,
      "after",
    );
  });
}
