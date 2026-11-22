import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { uploadRoomDocumentAsset } from "../room-document-assets";
import type {
  RoomDocumentEditor,
  RoomDocumentPartialBlock,
} from "../room-document-comment-schema";
import { CanvasMailAttachments } from "./canvas-mail-attachments";

vi.mock("../room-document-assets", () => ({
  uploadRoomDocumentAsset: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

function setup(initialFiles: RoomDocumentPartialBlock[] = [], size = 1024) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on(
    "GET",
    "/v0/document-assets/{documentAssetId}",
    ({ params }) => ({
      id: params.documentAssetId,
      filename: "brief.pdf",
      size_bytes: size,
      status: "available",
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const listeners = new Set<() => void>();
  let blocks = [
    { id: "body", type: "paragraph", props: {}, content: [], children: [] },
    ...initialFiles,
  ] as RoomDocumentEditor["document"];
  const notify = () => listeners.forEach((listener) => listener());
  const editor = {
    get document() {
      return blocks;
    },
    getBlock: (id: string) => blocks.find((block) => block.id === id),
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    insertBlocks: vi.fn((inserted: RoomDocumentPartialBlock[]) => {
      blocks = [
        ...blocks,
        ...inserted.map((block, index) => ({
          ...block,
          id: `uploaded_${index}`,
          children: [],
        })),
      ] as RoomDocumentEditor["document"];
      notify();
    }),
    removeBlocks: vi.fn((ids: string[]) => {
      blocks = blocks.filter((block) => !ids.includes(block.id));
      notify();
    }),
    resolveFileUrl: vi.fn(async () => "blob:attachment"),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const view = (editable = true) => (
    <QueryClientProvider client={queryClient}>
      <CanvasMailAttachments
        client={runtime.client}
        documentId="document_1"
        editor={editor as unknown as RoomDocumentEditor}
        editable={editable}
        scope="test"
      />
    </QueryClientProvider>
  );
  const result = render(view(), {
    container: host.appendChild(document.createElement("div")),
    baseElement: host,
  });
  return {
    ...result,
    editor,
    view,
    remote: (files: RoomDocumentPartialBlock[]) =>
      act(() => {
        blocks = [
          ...blocks.filter((block) => block.type !== "file"),
          ...files,
        ] as RoomDocumentEditor["document"];
        notify();
      }),
  };
}

function storedFile(
  id = "attached",
  name = "brief.pdf",
): RoomDocumentPartialBlock {
  return {
    id,
    type: "file",
    props: { name, url: `document-asset:${id}` },
    children: [],
  };
}

function choose(
  file = new File(["brief"], "brief.pdf", { type: "application/pdf" }),
) {
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: { files: [file] },
  });
}

describe("Mail attachments", () => {
  it("adds files from the + tile as durable file blocks and removes them without changing the body", async () => {
    vi.mocked(uploadRoomDocumentAsset).mockResolvedValue(
      "document-asset:asset_new",
    );
    const { editor } = setup();
    const input = screen.getByLabelText("Choose attachments");
    const pick = vi.spyOn(input as HTMLInputElement, "click");
    fireEvent.click(screen.getByRole("button", { name: "Add attachments" }));
    expect(pick).toHaveBeenCalledOnce();
    choose();
    await screen.findByRole("button", { name: "Remove brief.pdf" });
    expect(editor.document.at(-1)).toMatchObject({
      type: "file",
      props: { name: "brief.pdf", url: "document-asset:asset_new" },
    });
    expect(await screen.findByText("1 KB")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove brief.pdf" }));
    expect(editor.document.map((block) => block.id)).toEqual(["body"]);
    expect(screen.queryByRole("button", { name: "brief.pdf" })).toBeNull();
  });

  it("keeps an image chosen as an attachment in a file block", async () => {
    vi.mocked(uploadRoomDocumentAsset).mockResolvedValue(
      "document-asset:asset_image",
    );
    const { editor } = setup();
    choose(new File(["image"], "diagram.png", { type: "image/png" }));
    await screen.findByRole("button", { name: "Remove diagram.png" });
    expect(editor.document.at(-1)?.type).toBe("file");
  });

  it("shows an upload failure without inserting a broken block and allows a retry", async () => {
    vi.mocked(uploadRoomDocumentAsset)
      .mockRejectedValueOnce(new Error("Upload unavailable"))
      .mockResolvedValueOnce("document-asset:asset_retry");
    const { editor } = setup();
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Upload unavailable",
    );
    expect(editor.insertBlocks).not.toHaveBeenCalled();
    choose();
    await screen.findByRole("button", { name: "Remove brief.pdf" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("includes existing attachments in the size limit before uploading", async () => {
    const { editor } = setup([storedFile()], 15 << 20);
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("15 MB");
    expect(uploadRoomDocumentAsset).not.toHaveBeenCalled();
    expect(editor.insertBlocks).not.toHaveBeenCalled();
  });

  it("reflects collaborative file changes and hides mutations in read-only mode", async () => {
    const { remote, rerender, view } = setup();
    remote([storedFile()]);
    await screen.findByRole("button", { name: "Remove brief.pdf" });
    rerender(view(false));
    expect(
      screen.queryByRole("button", { name: "Add attachments" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove brief.pdf" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "brief.pdf" })).toBeVisible();
  });

  it.each(["readonly", "unmount"])(
    "does not insert an upload that completes after %s",
    async (transition) => {
      let finish!: (url: string) => void;
      vi.mocked(uploadRoomDocumentAsset).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { editor, unmount, rerender, view } = setup();
      choose();
      await waitFor(() =>
        expect(uploadRoomDocumentAsset).toHaveBeenCalledOnce(),
      );
      if (transition === "unmount") unmount();
      else rerender(view(false));
      await act(async () => finish("document-asset:asset_late"));
      expect(editor.insertBlocks).not.toHaveBeenCalled();
    },
  );
});
