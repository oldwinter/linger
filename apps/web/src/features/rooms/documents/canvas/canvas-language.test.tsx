import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import type { RoomDocumentCollaborationSession } from "../room-document-collaboration";
import type {
  RoomDocumentEditor,
  RoomDocumentPartialBlock,
} from "../room-document-comment-schema";
import type { RoomDocumentSaveSnapshot } from "../room-document-save-tracker";
import { CanvasHeader, useCanvas } from "./canvas-header";
import { CanvasMailAttachments } from "./canvas-mail-attachments";
import { MailCanvasStatus } from "./canvas-mail-status";

vi.mock("../room-document-assets", () => ({
  uploadRoomDocumentAsset: vi.fn(),
}));

const canvas = zhCN.canvas;

function headerEditor(text: string) {
  return {
    document: [
      {
        id: "block_canvas",
        type: "codeBlock",
        content: [{ type: "text", text, styles: {} }],
        children: [],
        props: {},
      },
    ],
    onChange: () => () => {},
    updateBlock: vi.fn(),
  } as unknown as RoomDocumentEditor;
}

function Header({ editor }: { editor: RoomDocumentEditor }) {
  const { agentEditing, canvas } = useCanvas(editor, undefined);
  return canvas ? (
    <CanvasHeader
      agentEditing={agentEditing}
      canvas={canvas}
      editable={false}
      editor={editor}
    />
  ) : null;
}

function session(status: RoomDocumentSaveSnapshot["status"]) {
  const snapshot = { canEdit: true, status } as RoomDocumentSaveSnapshot;
  return {
    getSaveSnapshot: () => snapshot,
    readOnly: false,
    subscribeSaveState: () => () => {},
  } as unknown as RoomDocumentCollaborationSession;
}

function renderAttachments(size: number) {
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
  const file: RoomDocumentPartialBlock = {
    id: "attached",
    type: "file",
    props: { name: "brief.pdf", url: "document-asset:attached" },
    children: [],
  };
  const editor = {
    document: [file],
    getBlock: (id: string) => (id === file.id ? file : undefined),
    onChange: () => () => {},
    insertBlocks: vi.fn(),
    removeBlocks: vi.fn(),
    resolveFileUrl: vi.fn(async () => "blob:attachment"),
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CanvasMailAttachments
        client={runtime.client}
        documentId="document_1"
        editable
        editor={editor as unknown as RoomDocumentEditor}
        scope="test"
      />
    </QueryClientProvider>,
  );
}

describe("the mail canvas in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("names the canvas header and its fields in Chinese", async () => {
    await setLanguage("zh-CN");
    render(
      <Header
        editor={headerEditor(
          "canvas: gmail\nto: lisa@acme.com\nsubject: Pricing\nstatus: draft\nlink: https://mail.google.com/mail/#drafts",
        )}
      />,
    );

    expect(
      screen.getByRole("region", {
        name: canvas.canvasLabel.replace("{target}", "Gmail"),
      }),
    ).toBeVisible();
    expect(screen.getByLabelText(canvas.to)).toHaveValue("lisa@acme.com");
    expect(screen.getByLabelText(canvas.subject)).toHaveValue("Pricing");
    expect(screen.getByLabelText(canvas.cc)).toHaveAttribute(
      "placeholder",
      canvas.none,
    );
    expect(screen.getByRole("link", { name: canvas.draftSaved })).toBeVisible();
  });

  it("words the email status in Chinese", async () => {
    await setLanguage("zh-CN");
    render(
      <MailCanvasStatus isEditing sent={false} session={session("Saved")} />,
    );
    const status = screen.getByRole("status", { name: canvas.emailStatus });
    expect(status).toHaveTextContent(canvas.saved);
  });

  it("names the attachment controls in Chinese and marks the remove button", async () => {
    await setLanguage("zh-CN");
    renderAttachments(15 << 20);

    const attachments = screen.getByRole("region", {
      name: canvas.emailAttachments,
    });
    const remove = await within(attachments).findByRole("button", {
      name: canvas.removeAttachment.replace("{name}", "brief.pdf"),
    });
    expect(remove).toHaveAttribute("data-voice-risk", "never");
    expect(
      within(attachments).getByRole("button", { name: canvas.addAttachments }),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText(canvas.chooseAttachments), {
      target: {
        files: [new File(["brief"], "notes.pdf", { type: "application/pdf" })],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      canvas.attachmentsTooLarge.replace("{megabytes}", "15"),
    );
  });
});
