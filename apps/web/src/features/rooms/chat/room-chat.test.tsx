import { defineGlobalProperty } from "@/test/global-properties";
import { seedRoomUpload } from "@/test/document-scenarios";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHubError } from "@/features/teamhub/teamhub-client";
import {
  type TeamHubRuntime,
  TeamHubRuntimeProvider,
} from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubActorRef,
  TeamHubMessage,
  TeamHubRunStatus,
} from "@/features/teamhub/teamhub-types";

import { messageQuoteText } from "./message-quote";
import { RoomChat } from "./room-chat";
import { roomMessageSender } from "./room-message-sender";
import { browserRoomMessageOutbox } from "./room-message-outbox";
import { resolveRoomMessagePresentations } from "./room-message-presentations";
import {
  repliedRunScenario,
  renderRoomChat,
  createTestStorage,
  message,
  presentedAttachment,
  loadedRoomChatQueryClient,
  testQueryClient,
  createTestTeamHubRuntime,
  openPanelTab,
  TestRoomChrome,
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

  it("renders existing messages while the tenant actor directory is pending", async () => {
    const runtime = createTestTeamHubRuntime();

    let releaseActors!: () => void;
    const actorsPending = new Promise<void>((resolve) => {
      releaseActors = resolve;
    });
    const actorsSpy = vi.fn(async () => {
      await actorsPending;
      return { items: runtime.seed.actors, page: { has_more: false } };
    });
    runtime.server.on("GET", "/v0/tenants/{tenantId}/actors", actorsSpy);

    try {
      await act(async () => {
        await renderRoomChat(runtime, await loadedRoomChatQueryClient(runtime));
      });
      await waitFor(() => expect(actorsSpy).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByText(/Reviewed the checklist/)).toBeInTheDocument(),
      );
      expect(screen.queryByText("Loading Room")).not.toBeInTheDocument();
    } finally {
      await act(async () => releaseActors());
    }
  });

  it("keeps known delivery mentions while RoomSurface owns attachment tombstones", () => {
    const delegate: TeamHubActorRef = {
      display_name: "Jenny's Delegate",
      id: "actor-delegate",
      kind: "agent",
      tenant_id: "tenant-northstar",
    };
    const deletedMessage: TeamHubMessage = {
      ...message("message-deleted-attachment", "@Jenny's_Delegate"),
      attachments: [
        {
          document_id: "document-1",
          document_version_id: "version-1",
          available: true,
          filename: "report.txt",
          id: "attachment-1",
          media_type: "text/plain",
          sha256: "a".repeat(64),
          size_bytes: 12,
        },
      ],
      segments: [
        {
          content: "@Jenny's_Delegate",
          target: delegate.id,
          target_type: "agent",
          type: "reference",
        },
      ],
    };

    const resolved = resolveRoomMessagePresentations({
      deliveryPresentations: {
        [deletedMessage.id]: {
          attachments: [presentedAttachment(true)],
          mentions: [delegate],
        },
      },
      mentionOptions: [],
      messages: [deletedMessage],
      roomMessagePresentations: {
        [deletedMessage.id]: {
          attachments: [presentedAttachment(false)],
          mentions: [],
        },
      },
    });

    expect(resolved[deletedMessage.id]?.attachments[0]?.available).toBe(false);
    expect(resolved[deletedMessage.id]?.mentions).toEqual([delegate]);
  });

  it("keeps persisted attachments when a Room presentation has none", () => {
    const attachedMessage: TeamHubMessage = {
      ...message("message-agent-file", "Here is the result."),
      attachments: [
        {
          available: true,
          document_id: "document-result",
          document_version_id: "version-result",
          filename: "result.md",
          id: "attachment-result",
          media_type: "text/markdown",
          sha256: "a".repeat(64),
          size_bytes: 801,
        },
      ],
    };

    const resolved = resolveRoomMessagePresentations({
      deliveryPresentations: {},
      mentionOptions: [],
      messages: [attachedMessage],
      roomMessagePresentations: {
        [attachedMessage.id]: { attachments: [], mentions: [] },
      },
    });

    expect(resolved[attachedMessage.id]?.attachments).toMatchObject([
      {
        available: true,
        filename: "result.md",
        mediaType: "text/markdown",
        sizeBytes: 801,
      },
    ]);
  });

  it("keeps a RoomSurface mention when current member options have not refreshed", () => {
    const delegate: TeamHubActorRef = {
      display_name: "Jenny's Delegate",
      id: "actor-delegate",
      kind: "agent",
      tenant_id: "tenant-northstar",
    };
    const mentionedMessage: TeamHubMessage = {
      ...message("message-room-mention", "@Jenny's_Delegate"),
      segments: [
        {
          content: "@Jenny's_Delegate",
          target: delegate.id,
          target_type: "agent",
          type: "reference",
        },
      ],
    };

    const resolved = resolveRoomMessagePresentations({
      deliveryPresentations: {
        [mentionedMessage.id]: { attachments: [], mentions: [] },
      },
      mentionOptions: [],
      messages: [mentionedMessage],
      roomMessagePresentations: {
        [mentionedMessage.id]: {
          attachments: [],
          mentions: [delegate],
        },
      },
    });

    expect(resolved[mentionedMessage.id]?.mentions).toEqual([delegate]);
  });

  it("derives mentions for historical messages without a presentation", () => {
    const delegate: TeamHubActorRef = {
      display_name: "Jenny's Delegate",
      id: "actor-delegate",
      kind: "agent",
      tenant_id: "tenant-northstar",
    };
    const mentionedMessage: TeamHubMessage = {
      ...message("message-historical-mention", "@Jenny's_Delegate"),
      segments: [
        {
          content: "@Jenny's_Delegate",
          target: delegate.id,
          target_type: "agent",
          type: "reference",
        },
      ],
    };

    const resolved = resolveRoomMessagePresentations({
      deliveryPresentations: {},
      mentionOptions: [delegate],
      messages: [mentionedMessage],
      roomMessagePresentations: {},
    });

    expect(resolved[mentionedMessage.id]?.mentions).toEqual([delegate]);
  });

  it("reconciles one sent Message into committed Room history", async () => {
    const runtime = createTestTeamHubRuntime();

    const queryClient = testQueryClient();
    const router = createMemoryRouter(
      [
        {
          element: <RoomChat />,
          path: "/t/:tenantId/rooms/:roomId/chat",
        },
      ],
      {
        initialEntries: ["/t/tenant-northstar/rooms/room-all/chat"],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <Suspense fallback={<p>Loading Room</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
      { wrapper: TestRoomChrome },
    );

    await screen.findByText(/Reviewed the checklist/);
    fireEvent.change(await screen.findByLabelText("Message Room"), {
      target: { value: "@Codex prepare the V0 handoff" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          (_, element) =>
            element?.tagName === "P" &&
            element.textContent === "@Codex prepare the V0 handoff",
        ),
      ).toBeVisible(),
    );
  });

  it("offers Voice Mode in a group Room's main composer", async () => {
    const runtime = createTestTeamHubRuntime();

    const router = createMemoryRouter(
      [{ element: <RoomChat />, path: "/t/:tenantId/rooms/:roomId/chat" }],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/chat"] },
    );

    render(
      <QueryClientProvider client={testQueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <Suspense fallback={<p>Loading Room</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
      { wrapper: TestRoomChrome },
    );

    await screen.findByLabelText("Message Room");
    expect(
      await screen.findByRole("button", { name: "Start Voice Mode" }),
    ).toBeInTheDocument();
  });

  it("projects the Room Run Status bootstrap above the composer as an anchored turn status", async () => {
    const runtime = createTestTeamHubRuntime();

    await act(async () => {
      await renderRoomChat(runtime, await loadedRoomChatQueryClient(runtime));
    });

    const status = await screen.findByRole("button", {
      name: "Open Agents working activity",
    });
    // The Run's earlier search plays first, then the line rests on its last step.
    await waitFor(
      () => expect(status).toHaveAttribute("title", "Codex: Using tools"),
      { timeout: 3000 },
    );
    expect(
      screen.queryByRole("article", { name: "Live Agent status from Codex" }),
    ).not.toBeInTheDocument();
    const composer = screen.getByLabelText("Message Room");
    const dock = screen.getByTestId("agent-streaming-status-dock");
    expect(
      dock.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The status line opens the Agent's activity directly, with no popover.
    fireEvent.click(status);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(openPanelTab).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "actor-codex",
        kind: "agentActivity",
        title: "Activity · Codex",
      }),
    );
    const opened = openPanelTab.mock.calls.at(-1)?.[0] as {
      activityRunStatusId?: string;
      anchorMessageId?: string;
    };
    expect(opened.activityRunStatusId ?? opened.anchorMessageId).toBeTruthy();
  });

  it("shows the Run a sent message wakes until its pushed Run status ends", async () => {
    const fixture = createTestTeamHubRuntime();
    const createMessage = vi.spyOn(
      roomMessageSender(fixture.client),
      "createMessage",
    );
    let onCollection: ((runs: TeamHubRunStatus[]) => void) | undefined;
    const runtime: TeamHubRuntime = {
      ...fixture,
      runStatuses: {
        subscribe(input) {
          onCollection = input.onCollection;
          input.onCollection([]);
          return () => {
            onCollection = undefined;
          };
        },
      },
    };
    const run: TeamHubRunStatus = {
      agent: { display_name: "Codex", id: "actor-codex", kind: "agent" },
      created_at: "2026-10-20T02:00:00Z",
      id: "run-owed",
      replied: false,
      revision: 0,
      room_id: "room-dm-codex",
      run_id: "run-owed",
      status: "active",
      updated_at: "2026-10-20T02:00:00Z",
    };

    await renderRoomChat(
      runtime,
      testQueryClient(),
      "/t/tenant-northstar/rooms/room-dm-codex/chat",
    );
    fireEvent.change(await screen.findByLabelText("Message Room"), {
      target: { value: "Start the V0 review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(createMessage).toHaveBeenCalledOnce());
    // TeamHub queues the Run in the message transaction and pushes its status.
    act(() => onCollection?.([run]));
    expect(
      await screen.findByRole("button", {
        name: "Open Agents working activity",
      }),
    ).toHaveAttribute("title", "Codex: Starting");

    act(() => onCollection?.([{ ...run, revision: 1, status: "completed" }]));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open Agents working activity" }),
      ).toBeNull(),
    );
  });

  it("retries the accepted contextual composition without restoring it over the next draft", async () => {
    const runtime = createTestTeamHubRuntime();

    const retryDocument = await seedRoomUpload(runtime, "retry", {
      file: new File(["retry"], "retry.txt", { type: "text/plain" }),
      representationFormat: "text",
    });
    const committed = {
      ...message("retry-declared", "Retry with the selected context"),
      attachments: [
        {
          document_id: retryDocument.id,
          document_version_id: retryDocument.current_version!.id,
          available: true,
          filename: "retry.txt",
          id: "retry-attachment",
          media_type: "text/plain",
          sha256: retryDocument.current_version!.sha256,
          size_bytes: 5,
        },
      ],
    };
    const composition = roomMessageSender(runtime.client);
    vi.spyOn(composition, "stageAttachment").mockResolvedValue(undefined);
    const createMessage = vi
      .spyOn(composition, "createMessage")
      .mockRejectedValueOnce(
        new TeamHubError({
          code: "ATTACHMENT_STAGING_FAILED",
          message: "Fixture staging failed.",
          status: 400,
        }),
      )
      .mockResolvedValueOnce({
        message: committed,
        presentation: {
          attachments: [
            {
              id: "retry-attachment",
              document: { id: retryDocument.id, title: "retry.txt" },
              available: true,
              filename: "retry.txt",
              mediaType: "text/plain",
              sizeBytes: 5,
            },
          ],
          mentions: [],
        },
      });

    await renderRoomChat(runtime, testQueryClient());

    await screen.findByLabelText("Message Room");
    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "More message actions",
        })
      )[0]!,
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Reply to message" }),
    );
    expect(screen.getByLabelText("Selected reply context")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Message Room"), {
      target: { value: "Retry with the selected context" },
    });
    fireEvent.change(screen.getByLabelText("Choose message attachments"), {
      target: {
        files: [new File(["retry"], "retry.txt", { type: "text/plain" })],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      (await screen.findAllByText("Fixture staging failed."))[0],
    ).toBeVisible();
    expect(screen.queryByLabelText("Selected reply context")).toBeNull();
    expect(screen.getByLabelText("Message Room")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Message Room"), {
      target: { value: "Newer draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("retry.txt")).toBeVisible());
    await waitFor(() =>
      expect(screen.queryByLabelText("Selected reply context")).toBeNull(),
    );
    expect(screen.getByLabelText("Message Room")).toHaveValue("Newer draft");
    expect(createMessage.mock.calls[0]?.[0].idempotencyKey).toBe(
      createMessage.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(createMessage.mock.calls[1]?.[0].contextMessageIds).toEqual(
      createMessage.mock.calls[0]?.[0].contextMessageIds,
    );
  });

  it("adds dropped files to the current Room composer and sends them there", async () => {
    const runtime = createTestTeamHubRuntime();

    const composition = roomMessageSender(runtime.client);
    vi.spyOn(composition, "stageAttachment").mockResolvedValue(undefined);
    const createMessage = vi
      .spyOn(composition, "createMessage")
      .mockResolvedValueOnce({
        message: message("dropped-declared", ""),
        presentation: { attachments: [], mentions: [] },
      });
    await renderRoomChat(runtime, testQueryClient());

    await screen.findByLabelText("Message Room");
    const target = screen.getByTestId("room-chat-file-drop-target");
    const file = new File(["dropped"], "dropped-plan.txt", {
      type: "text/plain",
    });
    const dataTransfer = {
      dropEffect: "none",
      files: [file],
      items: [{ kind: "file" }],
      types: ["Files"],
    } as unknown as DataTransfer;

    fireEvent.dragEnter(target, { dataTransfer });
    expect(
      screen.getByText("Release to add to the current message"),
    ).toBeVisible();
    fireEvent.drop(target, { dataTransfer });
    expect(screen.getByText("dropped-plan.txt")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createMessage).toHaveBeenCalled());
    expect(
      createMessage.mock.calls
        .at(-1)?.[0]
        .attachments.map((attachment) => attachment.file),
    ).toEqual([file]);
  });

  it("keeps attachment upload in the composer and removes upload controls from the outgoing Message", async () => {
    const runtime = createTestTeamHubRuntime();

    vi.spyOn(
      roomMessageSender(runtime.client),
      "stageAttachment",
    ).mockResolvedValue(undefined);
    vi.spyOn(
      roomMessageSender(runtime.client),
      "createMessage",
    ).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          );
        }),
    );

    await renderRoomChat(runtime, testQueryClient());

    await screen.findByLabelText("Message Room");
    fireEvent.change(screen.getByLabelText("Choose message attachments"), {
      target: {
        files: [new File(["cancel"], "cancel.txt", { type: "text/plain" })],
      },
    });
    expect(
      screen.getByRole("status", { name: "Uploading cancel.txt" }),
    ).toBeVisible();
    expect(screen.queryByText("Sending...")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("cancel.txt")).toBeVisible();
    // The status line appears only once the send has taken a moment.
    expect(screen.queryByText("Sending...")).toBeNull();
    expect(
      await screen.findByText("Sending...", undefined, { timeout: 2000 }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Cancel upload" })).toBeNull();
  });

  it("keeps a lost command response unknown and retries the same intent", async () => {
    const runtime = createTestTeamHubRuntime();

    const composition = roomMessageSender(runtime.client);
    const originalCreateMessage = composition.createMessage.bind(composition);
    const createMessage = vi
      .spyOn(composition, "createMessage")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(originalCreateMessage);

    await renderRoomChat(runtime, testQueryClient());

    const editor = await screen.findByLabelText("Message Room");
    fireEvent.change(editor, { target: { value: "Ambiguous delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Delivery status unknown")).toBeVisible();
    expect(
      screen.getByText(/did not confirm whether this Message was committed/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(2));
    expect(createMessage.mock.calls[0]?.[0].idempotencyKey).toBe(
      createMessage.mock.calls[1]?.[0].idempotencyKey,
    );
  });
});

describe("Room Chat replied Run", () => {
  beforeEach(async () => {
    await browserRoomMessageOutbox.clearAccount("account-jenny");
  });

  it("leaves the Dock when TeamHub marks the Run replied and returns when it is not", async () => {
    const scenario = repliedRunScenario();
    const queryClient = await loadedRoomChatQueryClient(scenario.runtime);
    await act(async () => {
      await renderRoomChat(scenario.runtime, queryClient);
    });
    expect(
      await screen.findByRole("button", {
        name: "Open Agents working activity",
      }),
    ).toBeVisible();

    scenario.publish({ replied: true, revision: 2 });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Open Agents working activity",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Stop Codex's task" }),
    ).not.toBeInTheDocument();

    scenario.publish({ replied: false, revision: 3 });
    expect(
      await screen.findByRole("button", {
        name: "Open Agents working activity",
      }),
    ).toBeVisible();
  });

  it.each([true, false])(
    "sends a follow-up at once while the Run is active (replied=%s)",
    async (replied) => {
      const scenario = repliedRunScenario();
      scenario.publish({ replied, revision: 2 });
      const queryClient = await loadedRoomChatQueryClient(scenario.runtime);
      await act(async () => {
        await renderRoomChat(scenario.runtime, queryClient);
      });

      const editor = await screen.findByLabelText("Message Room");
      fireEvent.change(editor, { target: { value: "@Cod" } });
      fireEvent.click(await screen.findByRole("option", { name: /^Codex/ }));
      fireEvent.change(editor, {
        target: {
          value: `${(editor as HTMLTextAreaElement).value}one more thing`,
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      await waitFor(() =>
        expect(scenario.createMessage).toHaveBeenCalledOnce(),
      );
      expect(scenario.createMessage.mock.calls[0]?.[0]).toMatchObject({
        body: expect.stringContaining("one more thing"),
        mentions: [expect.objectContaining({ id: "actor-codex" })],
      });
      expect(screen.queryByText("Queued")).not.toBeInTheDocument();
    },
  );

  it("creates a Work Item issue from a Message draft", async () => {
    const runtime = createTestTeamHubRuntime();
    const raw =
      "I moved the launch notes into Shared Documents. @codex, please review the release checklist.";
    const create = vi.fn<TestRouteHandler>(() => ({
      assignees: [],
      created_at: "2026-07-23T10:00:00Z",
      created_by: runtime.seed.actors[0]!,
      description: "",
      explicit_access_grants: [],
      id: "workitem-from-message",
      kind: "issue",
      number: 43,
      priority: "medium",
      referenced_actors: [],
      state: "open",
      tenant_id: "tenant-northstar",
      title: raw,
      updated_at: "2026-07-23T10:00:00Z",
      updated_by: runtime.seed.actors[0]!,
      version: 1,
    }));
    runtime.server.on("POST", "/v0/tenants/{tenantId}/work-items", create);

    const router = await renderRoomChat(runtime, testQueryClient());

    const body = await screen.findByText(/I moved the launch notes/);
    fireEvent.click(
      within(body.closest("article")!).getByRole("button", {
        name: "More message actions",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Create issue" }));

    const description = messageQuoteText({
      authorName: "Maya Chen",
      createdAt: "2026-07-23T09:12:00Z",
      message: raw,
    });
    const dialog = screen.getByRole("dialog", { name: "New issue" });
    expect(within(dialog).getByLabelText("Title")).toHaveValue(raw);
    expect(within(dialog).getByLabelText("Description")).toHaveValue(
      description,
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Origin Room" }),
    ).toHaveTextContent("#all");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create issue" }),
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].body).toEqual({
      description,
      kind: "issue",
      origin_room_id: "room-all",
      priority: "medium",
      title: raw,
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/t/tenant-northstar/dashboard/workitem-from-message",
      ),
    );
  });

  it("sends a quoted reply as one message without reply context", async () => {
    const runtime = createTestTeamHubRuntime();
    const createMessage = vi.spyOn(
      roomMessageSender(runtime.client),
      "createMessage",
    );

    await renderRoomChat(runtime, testQueryClient());

    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("Message Room");
    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "More message actions",
        })
      )[0]!,
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Reply with quote" }),
    );

    const strip = screen.getByLabelText("Quoted reply");
    expect(strip).toBeVisible();
    const staged = editor.value;
    expect(staged).toMatch(/^> .+, \d{4}-\d\d-\d\d \d\d:\d\d\n>\n/u);
    expect(staged.endsWith("\n\n")).toBe(true);

    fireEvent.change(editor, {
      target: { value: `${staged}Under the quote.` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createMessage).toHaveBeenCalledOnce());
    const sent = createMessage.mock.calls[0]?.[0];
    expect(sent?.body).toBe(`${staged}Under the quote.`);
    expect(sent?.contextMessageIds).toEqual([]);
    await waitFor(() =>
      expect(screen.queryByLabelText("Quoted reply")).toBeNull(),
    );
  });

  it("hides the quoted reply while a structured reply is staged", async () => {
    const runtime = createTestTeamHubRuntime();
    const createMessage = vi.spyOn(
      roomMessageSender(runtime.client),
      "createMessage",
    );

    await renderRoomChat(runtime, testQueryClient());

    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("Message Room");
    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "More message actions",
        })
      )[0]!,
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Reply to message" }),
    );
    expect(screen.getByLabelText("Selected reply context")).toBeVisible();

    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "More message actions",
        })
      )[0]!,
    );
    expect(
      await screen.findByRole("menuitem", { name: "Reply to message" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Reply with quote" }),
    ).toBeNull();
    fireEvent.keyDown(editor, { key: "Escape" });

    fireEvent.change(editor, { target: { value: "Continuing the context." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createMessage).toHaveBeenCalledOnce());
    expect(createMessage.mock.calls[0]?.[0].contextMessageIds).toHaveLength(1);
  });

  it("focuses and highlights the Message a link names", async () => {
    const runtime = createTestTeamHubRuntime();
    defineGlobalProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    await renderRoomChat(
      runtime,
      testQueryClient(),
      "/t/tenant-northstar/rooms/room-all/chat?message=message-2",
    );

    const target = (await screen.findAllByRole("article")).find(
      (article) => article.dataset.messageId === "message-2",
    );
    expect(target).toBeDefined();
    expect(target).toHaveAttribute("data-focused-message", "true");
    expect(target).toHaveClass("message-row-focused");
    expect(
      screen
        .getAllByRole("article")
        .filter((article) => article.hasAttribute("data-focused-message")),
    ).toHaveLength(1);
  });

  it("leaves the timeline unfocused when the location names no Message", async () => {
    const runtime = createTestTeamHubRuntime();

    await renderRoomChat(runtime, testQueryClient());

    await screen.findByText(/Reviewed the checklist/);
    expect(
      screen
        .getByLabelText("Room timeline")
        .querySelector("[data-focused-message]"),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Linked source Message" }),
    ).not.toBeInTheDocument();
  });

  it("drops the highlight when the location no longer names the Message", async () => {
    const runtime = createTestTeamHubRuntime();
    defineGlobalProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    const router = await renderRoomChat(
      runtime,
      testQueryClient(),
      "/t/tenant-northstar/rooms/room-all/chat?message=message-2",
    );
    await waitFor(() =>
      expect(
        screen
          .getByLabelText("Room timeline")
          .querySelector("[data-focused-message]"),
      ).not.toBeNull(),
    );

    await act(async () => {
      await router.navigate("/t/tenant-northstar/rooms/room-all/chat");
    });

    expect(
      screen
        .getByLabelText("Room timeline")
        .querySelector("[data-focused-message]"),
    ).toBeNull();
  });

  it("says a linked Message is unavailable instead of failing the Room", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", "/v0/rooms/{roomId}/messages/{messageId}", () =>
      teamHubErrorResponse(
        404,
        "MESSAGE_NOT_FOUND",
        "The Message was not found.",
      ),
    );

    await renderRoomChat(
      runtime,
      testQueryClient(),
      "/t/tenant-northstar/rooms/room-all/chat?message=message-deleted",
    );

    expect(
      await screen.findByText("Source Message is unavailable."),
    ).toBeVisible();
    expect(await screen.findByText(/Reviewed the checklist/)).toBeVisible();
  });
});
