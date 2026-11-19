import { defineGlobalProperty } from "@/test/global-properties";
import {
  showDocument,
  seedRoomDocument,
  seedNativeDocument,
  seedRoomUpload,
} from "@/test/document-scenarios";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { writeRoomComposerDraft } from "../room-drafts";
import * as documentRoutePreload from "../documents/document-route-preload";
import { roomMessageSender } from "./room-message-sender";
import { browserRoomMessageOutbox } from "./room-message-outbox";
import {
  renderRoomChat,
  createTestStorage,
  appendCommittedMessage,
  message,
  testQueryClient,
  createTestTeamHubRuntime,
  readShareableDocuments,
  queriesTo,
  listRoomMessages,
  openPanelTab,
} from "./room-chat.fixtures";

beforeEach(() => {
  defineGlobalProperty(window, "localStorage", {
    configurable: true,
    value: createTestStorage(),
  });
});

describe("Room Chat", () => {
  beforeEach(async () => {
    openPanelTab.mockReset();
    await browserRoomMessageOutbox.clearAccount("account-jenny");
  });

  it("renders the declared Message, Mention, and previewable Document response", async () => {
    const runtime = createTestTeamHubRuntime();

    const file = new File(
      ["# Launch Plan\n\nReady for review."],
      "launch-plan.md",
      { type: "text/markdown" },
    );
    const document = await seedRoomUpload(runtime, "launch-plan", {
      file,
      representationFormat: "markdown",
    });
    const composition = roomMessageSender(runtime.client);
    vi.spyOn(composition, "stageAttachment").mockResolvedValue(undefined);
    const result = message("message-declared-attachment", "@Codex");
    result.segments = [
      {
        type: "reference",
        content: "@Codex",
        target: "actor-codex",
        target_type: "agent",
      },
    ];
    const create = vi
      .spyOn(composition, "createMessage")
      .mockResolvedValueOnce({
        message: result,
        presentation: {
          mentions: [
            {
              id: "actor-codex",
              display_name: "Codex",
              kind: "agent",
              tenant_id: "tenant-northstar",
            },
          ],
          attachments: [
            {
              id: document.id,
              document: { id: document.id, title: document.title },
              available: true,
              filename: file.name,
              mediaType: file.type,
              sizeBytes: file.size,
            },
          ],
        },
      });

    const router = await renderRoomChat(runtime, testQueryClient());

    const editor = await screen.findByLabelText("Message Room");
    fireEvent.change(editor, { target: { value: "@Cod" } });
    fireEvent.click(await screen.findByRole("option", { name: /Codex/ }));
    fireEvent.change(screen.getByLabelText("Choose message attachments"), {
      target: {
        files: [
          new File(["# Launch Plan\n\nReady for review."], "launch-plan.md", {
            type: "text/markdown",
          }),
        ],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Preview launch-plan.md" }),
        ).toBeVisible(),
      { timeout: 10_000 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview launch-plan.md" }),
    );
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "file",
          title: "launch-plan.md",
        }),
      ),
    );
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-all/chat",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "@Codex" }));
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith({
        actorId: "actor-codex",
        kind: "agentInfo",
        title: "Agent · Codex",
      }),
    );
    expect(router.state.location.search).toBe("");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room-all",
        attachments: [expect.objectContaining({ file: expect.any(File) })],
        mentions: [expect.objectContaining({ id: "actor-codex" })],
      }),
    );
  });

  it("opens the current Document from a historical file card without leaving Chat", async () => {
    const runtime = createTestTeamHubRuntime();

    const document = await seedRoomUpload(
      runtime,
      "room-chat-context-document-1",
      {
        file: new File(["context"], "conversation-context.md", {
          type: "text/markdown",
        }),
        representationFormat: "markdown",
      },
    );
    const contextMessage: TeamHubMessage = {
      ...message(
        "message-voice-context",
        "@AnotherMe summarize the discussion so far.",
      ),
      segments: [
        {
          content: "@AnotherMe summarize the discussion so far.\n",
          type: "text",
        },
        {
          content: "conversation-context.md",
          document_id: document.id,
          document_version_id: "historical-version",
          type: "file",
        },
      ],
    };
    const queryClient = testQueryClient();
    const router = await renderRoomChat(runtime, queryClient);
    await screen.findByText(/Reviewed the checklist/);
    appendCommittedMessage(queryClient, contextMessage);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Preview conversation-context.md",
      }),
    );

    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith({
        documentId: document.id,
        kind: "file",
        title: "conversation-context.md",
        previewCurrentVersion: true,
      }),
    );
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-all/chat",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a delivered native Document card without pinning a Version", async () => {
    const runtime = createTestTeamHubRuntime();

    const document = seedRoomDocument(runtime, "room-chat-native-card");
    const delivered: TeamHubMessage = {
      ...message("message-native-card", "notes.md"),
      segments: [
        {
          content: "notes.md",
          document_id: document.id,
          presentation: "card",
          type: "document",
        },
      ],
    };
    const queryClient = testQueryClient();
    await renderRoomChat(runtime, queryClient);
    await screen.findByText(/Reviewed the checklist/);
    appendCommittedMessage(queryClient, delivered);

    fireEvent.click(
      await screen.findByRole("button", { name: `Open ${document.title}` }),
    );

    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith({
        documentId: document.id,
        kind: "file",
        title: "notes.md",
      }),
    );
  });

  it("shows a gmail canvas as the email, with subject, recipients and Send", async () => {
    const runtime = createTestTeamHubRuntime();
    const document = seedRoomDocument(runtime, "room-chat-mail-canvas");
    runtime.server.on("GET", "/v0/documents/{documentId}/mail", () => ({
      source_digest: `sha256:${"0".repeat(64)}`,
      can_edit: true,
      status: "draft" as const,
      subject: "Updated invitation",
      to: "lisa@acme.com",
    }));
    // A second Gmail account: Send says which one it sends from.
    const [gmail] = runtime.seed.externalSources.connections.filter(
      (connection) => connection.provider === "gmail",
    );
    runtime.seed.externalSources.connections.push({
      ...gmail!,
      id: "external-connection-gmail-work",
      identity_label: "jenny@work.test",
    });
    let sentFrom: unknown;
    runtime.server.on("POST", "/v0/documents/{documentId}/mail", ({ body }) => {
      sentFrom = body;
      return {
        can_edit: true,
        source_digest: `sha256:${"0".repeat(64)}`,
        status: "queued" as const,
        subject: "Updated invitation",
        to: "lisa@acme.com",
      };
    });
    const queryClient = testQueryClient();
    await renderRoomChat(runtime, queryClient);
    await screen.findByText(/Reviewed the checklist/);
    appendCommittedMessage(queryClient, {
      ...message("message-mail-canvas", "Invitation"),
      segments: [
        {
          content: "Invitation",
          document_id: document.id,
          presentation: "canvas",
          type: "document",
        },
      ],
    });

    const email = await screen.findByRole("region", { name: "Email" });
    expect(email).toHaveTextContent("Updated invitation");
    expect(email).toHaveTextContent("To lisa@acme.com");
    expect(within(email).getByRole("button", { name: "Send" })).toBeVisible();
    expect(
      within(email).getByRole("button", { name: "Don't send" }),
    ).toBeVisible();
    expect(
      await within(email).findByRole("combobox", { name: "Send from" }),
    ).toHaveTextContent("jenny@linger.test");
    fireEvent.click(screen.getByRole("button", { name: "Open in side panel" }));
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: document.id, kind: "file" }),
      ),
    );

    runtime.server.on(
      "POST",
      "/v0/documents/{documentId}/mail/decline",
      () => ({
        can_edit: true,
        source_digest: `sha256:${"0".repeat(64)}`,
        status: "declined" as const,
        subject: "Updated invitation",
        to: "lisa@acme.com",
      }),
    );
    fireEvent.click(within(email).getByRole("button", { name: "Don't send" }));
    expect(await within(email).findByText("Not sent")).toBeVisible();
    expect(within(email).queryByRole("button", { name: "Send" })).toBeNull();
    expect(sentFrom).toBeUndefined();
  });

  it("sends the digest the card showed, and hides the actions from members who cannot edit", async () => {
    const runtime = createTestTeamHubRuntime();
    const document = seedRoomDocument(runtime, "room-chat-mail-readonly");
    const shown = `sha256:${"1".repeat(64)}`;
    let canEdit = true;
    runtime.server.on("GET", "/v0/documents/{documentId}/mail", () => ({
      can_edit: canEdit,
      source_digest: shown,
      status: "draft" as const,
      subject: "Pricing",
      to: "lisa@acme.com",
    }));
    let posted: { source_digest?: string } | undefined;
    runtime.server.on("POST", "/v0/documents/{documentId}/mail", ({ body }) => {
      posted = body as { source_digest?: string };
      return {
        can_edit: true,
        source_digest: shown,
        status: "sent" as const,
        subject: "Pricing",
        to: "lisa@acme.com",
      };
    });
    const queryClient = testQueryClient();
    await renderRoomChat(runtime, queryClient);
    await screen.findByText(/Reviewed the checklist/);
    appendCommittedMessage(queryClient, {
      ...message("message-mail-readonly", "Pricing"),
      segments: [
        {
          content: "Pricing",
          document_id: document.id,
          presentation: "canvas",
          type: "document",
        },
      ],
    });
    const email = await screen.findByRole("region", { name: "Email" });
    const send = await within(email).findByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(await within(email).findByText("Sent")).toBeVisible();
    expect(posted?.source_digest).toBe(shown);

    canEdit = false;
    await queryClient.resetQueries({ queryKey: ["mail-canvas", document.id] });
    await waitFor(() =>
      expect(
        within(email).queryByRole("button", { name: "Don't send" }),
      ).toBeNull(),
    );
  });

  it("warms only the Document surface chunk once a Document card is shown", async () => {
    const preload = vi
      .spyOn(documentRoutePreload, "preloadUnifiedDocumentPage")
      .mockResolvedValue(
        {} as Awaited<
          ReturnType<typeof documentRoutePreload.preloadUnifiedDocumentPage>
        >,
      );
    const runtime = createTestTeamHubRuntime();
    const document = seedRoomDocument(runtime, "room-chat-surface-prefetch");
    const queryClient = testQueryClient();
    await renderRoomChat(runtime, queryClient);
    await screen.findByText(/Reviewed the checklist/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(preload).not.toHaveBeenCalled();

    appendCommittedMessage(queryClient, {
      ...message("message-surface-prefetch", "notes.md"),
      segments: [
        {
          content: "notes.md",
          document_id: document.id,
          presentation: "card",
          type: "document",
        },
      ],
    });

    await waitFor(() => expect(preload).toHaveBeenCalledOnce());
    preload.mockRestore();
  });

  it("opens Composer Document references by stable unified identity", async () => {
    window.localStorage.clear();
    const runtime = createTestTeamHubRuntime();

    const router = await renderRoomChat(runtime, testQueryClient());
    const editor = await screen.findByLabelText("Message Room");

    fireEvent.change(editor, {
      target: { selectionStart: 4, value: "@Cod" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /^Codex/ }));
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.change(editor, {
      target: { selectionStart: 8, value: "@Codex @" },
    });
    fireEvent.keyDown(editor, { key: "ArrowRight" });
    fireEvent.keyDown(editor, { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("option", { name: /product-v0-brief\.md/i }),
    );

    let composerReferences = screen.getByRole("group", {
      name: "Composer references",
    });
    fireEvent.click(
      within(composerReferences).getByRole("button", {
        name: "Open Codex profile",
      }),
    );
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith({
        actorId: "actor-codex",
        kind: "agentInfo",
        title: "Agent · Codex",
      }),
    );
    expect(router.state.location.search).toBe("");
    composerReferences = screen.getByRole("group", {
      name: "Composer references",
    });

    fireEvent.click(
      within(composerReferences).getByRole("button", {
        name: "Open product-v0-brief.md",
      }),
    );
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith({
        documentId: "document-product-v0-brief",
        kind: "file",
        title: "product-v0-brief.md",
      }),
    );
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-all/chat",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Message Room")).toHaveValue(
      "@Codex @product-v0-brief_md ",
    );
    composerReferences = screen.getByRole("group", {
      name: "Composer references",
    });
    expect(
      within(composerReferences).getByRole("button", {
        name: "Open Codex profile",
      }),
    ).toBeVisible();
    expect(
      within(composerReferences).getByRole("button", {
        name: "Open product-v0-brief.md",
      }),
    ).toBeVisible();
  });

  it("offers only the Wiki Documents the caller owns in the Composer catalog", async () => {
    const runtime = createTestTeamHubRuntime();

    const page = await readShareableDocuments(runtime);
    runtime.server.on("GET", "/v0/library/documents", () => {
      const [sample] = page.items;
      if (!sample) return page;
      return {
        ...page,
        items: [
          ...page.items,
          // TeamHub's shareable view returns these because the Wiki owner can
          // read them, but only a Document's owner may bind it into a Room.
          {
            ...sample,
            capabilities: { ...sample.capabilities, manage: false },
            id: "document-wiki-page",
            title: "Generated Wiki page",
            from: [
              {
                binding_kind: "wiki_page" as const,
                context_id: "wiki-jenny",
                page_key: "projects/plan.md",
              },
            ],
          },
          {
            ...sample,
            capabilities: { ...sample.capabilities, manage: false },
            id: "document-memory-source",
            title: "Memory source file",
            from: [
              {
                binding_kind: "wiki_source" as const,
                context_id: "wiki-jenny",
              },
            ],
          },
          // A file the caller uploaded into their own Wiki is theirs to share.
          {
            ...sample,
            capabilities: { ...sample.capabilities, manage: true },
            id: "document-wiki-upload",
            title: "Café déjà vu",
            from: [
              {
                binding_kind: "wiki_source" as const,
                context_id: "wiki-jenny",
              },
            ],
          },
        ],
      };
    });
    await renderRoomChat(runtime, testQueryClient());
    const editor = await screen.findByLabelText("Message Room");
    fireEvent.change(editor, { target: { selectionStart: 1, value: "@" } });

    expect(
      await screen.findByRole("option", { name: /Café déjà vu/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /Generated Wiki page/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("option", { name: /Memory source file/ }),
    ).toBeNull();
  });

  it("searches TeamHub for a Document outside the loaded shareable page", async () => {
    const runtime = createTestTeamHubRuntime();

    const document = seedNativeDocument(runtime, "composer-document-search");
    showDocument(runtime, { ...document, title: "Quarterly launch plan" });
    const page = await readShareableDocuments(runtime);
    const list = vi.fn((_request: { query: URLSearchParams }) =>
      // The Document sits past the first page, exactly as it would in a large Tenant.
      ({
        items: page.items.filter((item) => item.id !== document.id),
        page: { has_more: true },
      }),
    );
    runtime.server.on("GET", "/v0/library/documents", list);
    runtime.server.on(
      "PUT",
      "/v0/rooms/{roomId}/documents/{documentId}",
      () => ({
        ...document,
        title: "Quarterly launch plan",
        from: [{ binding_kind: "room", context_id: "room-all" }],
      }),
    );
    const searches = () => queriesTo(runtime, "/v0/library/documents/search");
    await renderRoomChat(runtime, testQueryClient());
    const editor = await screen.findByLabelText("Message Room");
    expect(list).not.toHaveBeenCalled();
    expect(searches()).toEqual([]);

    fireEvent.change(editor, {
      target: { selectionStart: 2, value: "@Q" },
    });
    await waitFor(() =>
      expect(
        list.mock.calls.map(([request]) => Object.fromEntries(request.query)),
      ).toContainEqual({ limit: "50", view: "shareable" }),
    );
    // One character only filters the loaded page, as in the search dialog.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(searches()).toEqual([]);

    fireEvent.change(editor, {
      target: { selectionStart: 10, value: "@Quarterly" },
    });
    expect(
      await screen.findByRole("option", { name: /Quarterly launch plan/ }),
    ).toBeVisible();
    expect(list).toHaveBeenCalledTimes(1);
    expect(searches()).toEqual([
      { limit: "20", q: "Quarterly", tenant_id: "tenant-northstar" },
    ]);

    fireEvent.click(
      await screen.findByRole("option", { name: /Quarterly launch plan/ }),
    );

    // The pick survives the catalog dropping the search page once the picker closes.
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("group", { name: "Composer references" }),
        ).getByRole("button", { name: "Open Quarterly launch plan" }),
      ).toBeVisible(),
    );
  });

  it("keeps a restored draft Document reference outside the loaded page", async () => {
    const runtime = createTestTeamHubRuntime();

    const identity = runtime.seed.identity;
    const document = seedNativeDocument(runtime, "composer-draft-document");
    const page = await readShareableDocuments(runtime);
    runtime.server.on("GET", "/v0/library/documents", () => ({
      items: page.items.filter((item) => item.id !== document.id),
      page: { has_more: true },
    }));
    writeRoomComposerDraft(
      {
        accountId: identity.account.id,
        roomId: "room-all",
        tenantId: "tenant-northstar",
      },
      {
        body: "@untitled please review",
        documentContexts: [],
        documentReferences: [{ documentId: document.id, token: "@untitled" }],
        mentions: [],
        skillReferences: [],
      },
    );
    await renderRoomChat(runtime, testQueryClient());

    await waitFor(() =>
      expect(
        within(
          screen.getByRole("group", { name: "Composer references" }),
        ).getByRole("button", { name: `Open ${document.title}` }),
      ).toBeVisible(),
    );
  });

  it.each([false, true])(
    "finds a personal Document in another Room and gates sending on binding (failure=%s)",
    async (failBinding) => {
      const runtime = createTestTeamHubRuntime();

      const document = seedNativeDocument(runtime, "cross-room-doc-picker");
      const bind = vi.fn(() =>
        failBinding
          ? teamHubErrorResponse(403, "FORBIDDEN", "Access revoked")
          : {
              ...document,
              from: [{ binding_kind: "room", context_id: "room-all" }],
            },
      );
      runtime.server.on(
        "PUT",
        "/v0/rooms/{roomId}/documents/{documentId}",
        bind,
      );
      const lists = () => queriesTo(runtime, "/v0/library/documents");
      await renderRoomChat(runtime, testQueryClient());
      const editor = await screen.findByLabelText("Message Room");
      expect(lists()).toEqual([]);
      expect(bind).not.toHaveBeenCalled();
      fireEvent.change(editor, {
        target: { value: "@untit", selectionStart: 6 },
      });
      await waitFor(() =>
        expect(lists()).toContainEqual(
          expect.objectContaining({ view: "shareable" }),
        ),
      );
      fireEvent.click(await screen.findByRole("option", { name: /untitled/i }));
      await waitFor(() =>
        expect(bind).toHaveBeenCalledWith(
          expect.objectContaining({
            params: { documentId: document.id, roomId: "room-all" },
          }),
        ),
      );
      if (failBinding) {
        expect(
          await screen.findByText(/Document could not be shared/),
        ).toBeVisible();
        expect(editor).toHaveValue("@untit");
        return;
      }
      await waitFor(() =>
        expect(
          within(
            screen.getByRole("group", { name: "Composer references" }),
          ).getByRole("button", { name: `Open ${document.title}` }),
        ).toBeVisible(),
      );
      fireEvent.keyDown(editor, { key: "Enter" });
      await waitFor(async () =>
        expect(
          (await listRoomMessages(runtime, "room-all")).items.at(-1)?.segments,
        ).toContainEqual(
          expect.objectContaining({
            type: "document",
            document_id: document.id,
          }),
        ),
      );
    },
  );

  it.each(["human", "agent"] as const)(
    "sends a pasted %s-owned Document URL without binding before send",
    async (ownerKind) => {
      const runtime = createTestTeamHubRuntime();

      const document = seedNativeDocument(
        runtime,
        "room-chat-pasted-document-autobind",
      );
      const bindDocument = vi.fn(() =>
        teamHubErrorResponse(404, "NOT_FOUND", "Document was not found."),
      );
      runtime.server.on(
        "PUT",
        "/v0/rooms/{roomId}/documents/{documentId}",
        bindDocument,
      );
      if (ownerKind === "agent") {
        runtime.server.on("GET", "/v0/documents/{documentId}", () => ({
          ...document,
          capabilities: {
            ...document.capabilities,
            manage: false,
            delete: false,
          },
          owner: { ...document.owner, id: "actor-codex", kind: "agent" },
        }));
      }
      const createMessage = vi.spyOn(
        roomMessageSender(runtime.client),
        "createMessage",
      );
      const listDocuments = () =>
        runtime.server.requestsTo("GET", "/v0/rooms/{roomId}/documents");
      const router = await renderRoomChat(runtime, testQueryClient());
      const editor = await screen.findByLabelText("Message Room");
      await waitFor(() => expect(listDocuments().length).toBeGreaterThan(0));
      const initialDocumentLoads = listDocuments().length;

      fireEvent.paste(editor, {
        clipboardData: {
          getData: () =>
            `${window.location.origin}/t/tenant-northstar/documents/${document.id}`,
        },
      });
      expect(
        await within(
          screen.getByRole("group", { name: "Composer references" }),
        ).findByRole("button", { name: `Open ${document.title}` }),
      ).toBeVisible();
      expect(bindDocument).not.toHaveBeenCalled();
      expect(createMessage).not.toHaveBeenCalled();
      expect(listDocuments()).toHaveLength(initialDocumentLoads);

      fireEvent.keyDown(editor, { key: "Enter" });
      await waitFor(() => expect(createMessage).toHaveBeenCalledOnce());
      await waitFor(() =>
        expect(listDocuments().length).toBeGreaterThan(initialDocumentLoads),
      );
      expect(bindDocument).not.toHaveBeenCalled();
      await waitFor(async () => {
        const messages = await listRoomMessages(runtime, "room-all");
        expect(messages.items.at(-1)?.segments).toContainEqual(
          expect.objectContaining({
            document_id: document.id,
            type: "document",
          }),
        );
      });
      let sentMention: HTMLElement | undefined;
      await waitFor(() => {
        sentMention = screen
          .getAllByRole("button", { name: `Open ${document.title}` })
          .find((button) => button.closest("[data-message-id]"));
        expect(sentMention).toBeDefined();
      });
      expect(sentMention).toHaveAttribute("data-reference-kind", "document");

      fireEvent.click(sentMention!);
      await waitFor(() =>
        expect(openPanelTab).toHaveBeenCalledWith({
          documentId: document.id,
          kind: "file",
          title: document.title,
        }),
      );
      expect(router.state.location.pathname).toBe(
        "/t/tenant-northstar/rooms/room-all/chat",
      );
    },
  );

  it("keeps a cross-Tenant Document URL out of the current Room Context", async () => {
    const runtime = createTestTeamHubRuntime();

    await renderRoomChat(runtime, testQueryClient());
    const editor = await screen.findByLabelText("Message Room");
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", "/v0/rooms/{roomId}/documents").length,
      ).toBeGreaterThan(0),
    );
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () =>
          `${window.location.origin}/t/tenant-other/documents/document-private`,
      },
    });
    act(() => {
      editor.dispatchEvent(paste);
    });

    expect(paste.defaultPrevented).toBe(true);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Document cannot be shared in this Room.",
    );
    expect(
      runtime.server.requestsTo(
        "PUT",
        "/v0/rooms/{roomId}/documents/{documentId}",
      ),
    ).toHaveLength(0);
    expect(
      within(
        screen.getByRole("group", { name: "Composer references" }),
      ).queryByRole("button", { name: /Open/ }),
    ).toBeNull();
  });
});
