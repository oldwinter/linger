import { defineGlobalProperty } from "@/test/global-properties";
import { type TestRouteHandler } from "@/test/teamhub-test-server";
import { type InfiniteData } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type TeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMessage,
  TeamHubMessagePage,
} from "@/features/teamhub/teamhub-types";

import { roomMessagesQueryKey } from "../room-queries";

import { browserRoomMessageOutbox } from "./room-message-outbox";
import {
  renderRoomChat,
  restoreProperty,
  createTestStorage,
  withoutRealtime,
  appendCommittedMessage,
  message,
  testQueryClient,
  createTestTeamHubRuntime,
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

  it("loads a linked source Message even when it is outside recent history", async () => {
    const runtime = createTestTeamHubRuntime();

    const sourceMessage = message(
      "message-source",
      "This exact Message published the selected File.",
    );
    const getMessage = vi.fn<TestRouteHandler>(() => sourceMessage);
    runtime.server.on(
      "GET",
      "/v0/rooms/{roomId}/messages/{messageId}",
      getMessage,
    );

    await renderRoomChat(
      runtime,
      testQueryClient(),
      "/t/tenant-northstar/rooms/room-all/chat?message=message-source",
    );

    await screen.findByRole("region", {
      name: "Linked source Message",
    });
    await screen.findByText("This exact Message published the selected File.");
    const linkedSource = screen.getByRole("region", {
      name: "Linked source Message",
    });
    await waitFor(() =>
      expect(
        within(linkedSource).getByText(
          "This exact Message published the selected File.",
        ),
      ).toBeVisible(),
    );
    expect(
      within(linkedSource).getByRole("button", { name: "Copy message" }),
    ).toBeVisible();
    fireEvent.click(
      within(linkedSource).getByRole("button", {
        name: "More message actions",
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "Reply to message",
      }),
    );
    const selectedContext = screen.getByLabelText("Selected reply context");
    expect(selectedContext).toHaveTextContent(
      "This exact Message published the selected File.",
    );

    fireEvent.click(
      within(linkedSource).getByRole("button", {
        name: "More message actions",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply to message" }));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Message Room").value,
    ).toContain("@Codex");
    fireEvent.click(
      within(selectedContext).getByRole("button", {
        name: "Remove Codex from reply context",
      }),
    );
    expect(getMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { messageId: "message-source", roomId: "room-all" },
      }),
    );
    cleanup();
  });

  it("positions an independently loaded linked source without changing recent history", async () => {
    const runtime = createTestTeamHubRuntime();

    const queryClient = testQueryClient();
    const source = message("message-source", "Independently loaded source.");
    let resolveSource!: (value: TeamHubMessage) => void;
    const sourceRequest = new Promise<TeamHubMessage>((resolve) => {
      resolveSource = resolve;
    });
    runtime.server.on(
      "GET",
      "/v0/rooms/{roomId}/messages/{messageId}",
      () => sourceRequest,
    );
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1000);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    const positioned: string[] = [];
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.messageId === source.id) {
          positioned.push(source.id);
          const timeline = this.closest<HTMLElement>(
            '[aria-label="Room timeline"]',
          );
          timeline!.scrollTop = 400;
        }
      });
    try {
      await renderRoomChat(
        runtime,
        queryClient,
        "/t/tenant-northstar/rooms/room-all/chat?message=message-source",
      );
      await screen.findByText(/Reviewed the checklist/);
      const key = roomMessagesQueryKey("tenant-northstar", "room-all");
      const recentHistory =
        queryClient.getQueryData<InfiniteData<TeamHubMessagePage>>(key);
      expect(recentHistory).toBeDefined();
      expect(positioned).toEqual([]);
      await act(async () => resolveSource(source));
      await screen.findByText(source.raw_message);
      await waitFor(() => expect(positioned).toEqual([source.id]));
      expect(queryClient.getQueryData(key)).toBe(recentHistory);

      const timeline = screen.getByLabelText("Room timeline");
      timeline.scrollTop = 150;
      fireEvent.scroll(timeline);
      appendCommittedMessage(
        queryClient,
        message("message-after-link", "A later message."),
      );
      await screen.findByText("A later message.");
      expect(positioned).toEqual([source.id]);
      expect(timeline.scrollTop).toBe(150);
    } finally {
      resolveSource(source);
      scrollIntoView.mockRestore();
      vi.restoreAllMocks();
      cleanup();
      queryClient.clear();
    }
  });

  it("scrolls to a linked Message in the timeline instead of pinning a source card", async () => {
    const runtime = createTestTeamHubRuntime();

    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      await renderRoomChat(
        runtime,
        testQueryClient(),
        "/t/tenant-northstar/rooms/room-all/chat?message=message-2",
      );

      await screen.findByText(/Reviewed the checklist/);
      const target = screen
        .getAllByRole("article")
        .find((article) =>
          article.textContent?.includes("Reviewed the checklist"),
        );
      expect(target).toBeDefined();
      expect(
        screen.queryByRole("region", { name: "Linked source Message" }),
      ).not.toBeInTheDocument();
      expect(target).toHaveAttribute("data-message-id", "message-2");
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it("keeps a linked source Message visible above a long timeline", async () => {
    const runtime = createTestTeamHubRuntime();

    runtime.server.on("GET", "/v0/rooms/{roomId}/messages/{messageId}", () =>
      message("message-source", "This source Message must remain visible."),
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      "clientHeight",
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 1_000,
    });

    try {
      await renderRoomChat(
        runtime,
        testQueryClient(),
        "/t/tenant-northstar/rooms/room-all/chat?message=message-source",
      );

      await screen.findByText("This source Message must remain visible.");
      expect(screen.getByLabelText("Room timeline").scrollTop).toBe(0);
    } finally {
      restoreProperty(
        HTMLDivElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
      restoreProperty(
        HTMLDivElement.prototype,
        "scrollHeight",
        originalScrollHeight,
      );
    }
  });

  it("offers Copy and the same Thread action on every committed Message", async () => {
    const runtime = createTestTeamHubRuntime();

    const router = await renderRoomChat(runtime, testQueryClient());

    await screen.findByText(/Reviewed the checklist/);
    const activeRunMessage = screen
      .getAllByRole("article")
      .find((article) =>
        article.textContent?.includes("Reviewed the checklist"),
      );
    expect(activeRunMessage).toBeDefined();
    const copyButtons = screen.getAllByRole("button", {
      name: "Copy message",
    });
    const threadButtons = screen.getAllByRole("button", {
      name: "More message actions",
    });
    expect(
      screen.queryByRole("button", { name: "Reply to thread" }),
    ).toBeNull();
    expect(copyButtons.length).toBeGreaterThanOrEqual(4);
    expect(threadButtons.length).toBeGreaterThanOrEqual(4);

    fireEvent.click(
      within(activeRunMessage!).getByRole("button", {
        name: "More message actions",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply to thread" }));
    await waitFor(() =>
      expect(
        runtime.server
          .requestsTo("POST", "/v0/rooms/{roomId}/messages/{messageId}/thread")
          .map((request) => new URL(request.url).pathname),
      ).toContain("/v0/rooms/room-all/messages/message-2/thread"),
    );
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith(
        expect.objectContaining({
          anchorMessageId: "message-2",
          kind: "thread",
        }),
      ),
    );
    expect(router.state.location.search).toBe("");
    openPanelTab.mockClear();

    const ordinaryMessage = screen
      .getByText(/Keep the first release focused/)
      .closest("article")!;
    fireEvent.click(
      within(ordinaryMessage).getByRole("button", {
        name: "More message actions",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply to thread" }));
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith(
        expect.objectContaining({
          anchorMessageId: "message-4",
          kind: "thread",
        }),
      ),
    );
    expect(router.state.location.search).toBe("");
  });

  it("keeps Human avatars static while names mention and Agent avatars open Agent info", async () => {
    const runtime = createTestTeamHubRuntime();

    const router = await renderRoomChat(runtime, testQueryClient());

    await screen.findByText(/I moved the launch notes/);
    const mayaMessage = screen
      .getAllByRole("article")
      .find((article) =>
        article.textContent?.includes("I moved the launch notes"),
      );
    expect(mayaMessage).toBeDefined();
    fireEvent.click(
      within(mayaMessage!).getByRole("button", { name: "Maya Chen" }),
    );
    expect(screen.getByRole("textbox", { name: "Message Room" })).toHaveValue(
      "@Maya Chen ",
    );
    expect(router.state.location.search).toBe("");

    const avatar = within(mayaMessage!).getByRole("img", {
      name: "Maya Chen avatar",
    });
    expect(avatar.closest("button, a, [role=button]")).toBeNull();
    fireEvent.click(avatar);
    expect(router.state.location.search).toBe("");
    expect(
      within(mayaMessage!).queryByRole("button", {
        name: "Open Maya Chen profile",
      }),
    ).toBeNull();

    fireEvent.click(
      within(mayaMessage!).getByRole("button", {
        name: "More message actions",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply to thread" }));
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "thread",
        }),
      ),
    );
    expect(router.state.location.search).toBe("");

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open Codex status" })[0]!,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "View activity" }));
    await waitFor(() =>
      expect(openPanelTab).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "agentActivity",
          actorId: "actor-codex",
          title: "Activity · Codex",
        }),
      ),
    );
    expect(router.state.location.search).toBe("");
  });

  it("keeps local Thread inspection available in live mode", async () => {
    const fixture = createTestTeamHubRuntime();

    const runtime: TeamHubRuntime = {
      client: fixture.client,
      runStatuses: fixture.runStatuses,
      events: fixture.events,
    };

    await renderRoomChat(runtime, testQueryClient());

    await screen.findByText(/Reviewed the checklist/);
    expect(
      screen.getAllByRole("button", { name: "More message actions" }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(screen.queryByLabelText("Agent Run")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Lev8 GTM publication review"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Files view/)).not.toBeInTheDocument();

    const editor = screen.getByLabelText("Message Room");
    fireEvent.change(editor, { target: { selectionStart: 1, value: "@" } });
    expect(screen.getByRole("option", { name: /Jenny Bin/ })).toBeVisible();
    expect(await screen.findByRole("option", { name: /Codex/ })).toBeVisible();
  });

  it("preserves the visible history position when an older page is prepended", async () => {
    const fixture = createTestTeamHubRuntime();

    const allMessages = await listRoomMessages(fixture, "room-all");
    let resolveOlder!: (page: TeamHubMessagePage) => void;
    const olderPage = new Promise<TeamHubMessagePage>((resolve) => {
      resolveOlder = resolve;
    });
    const listMessages = vi
      .fn<TestRouteHandler>()
      .mockReturnValueOnce({
        items: allMessages.items.slice(2),
        page: { has_more: true, next_cursor: "older" },
        snapshot_room_seq: allMessages.snapshot_room_seq,
      })
      .mockReturnValueOnce(olderPage);
    fixture.server.on("GET", "/v0/rooms/{roomId}/messages", listMessages);
    const runtime = withoutRealtime(fixture);

    await renderRoomChat(runtime, testQueryClient());

    await screen.findByText(/Keep the first release focused/);
    const timeline = screen.getByLabelText("Room timeline");
    let scrollHeight = 400;
    Object.defineProperty(timeline, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(timeline, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    // Scrolling near the top loads the older page; there is no button.
    timeline.scrollTop = 100;
    fireEvent.scroll(timeline);
    expect(
      screen.queryByRole("button", { name: /Load earlier/ }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("status", { name: "Loading earlier Messages" }),
    ).toBeVisible();
    scrollHeight = 620;
    resolveOlder({
      items: allMessages.items.slice(0, 2),
      page: { has_more: false },
      snapshot_room_seq: allMessages.snapshot_room_seq,
    });

    await screen.findByText(/I moved the launch notes/);
    await waitFor(() => expect(timeline.scrollTop).toBe(320));
  });

  it("positions initial history at the bottom before revealing the timeline", async () => {
    const fixture = createTestTeamHubRuntime();

    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      "clientHeight",
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 1_000,
    });

    try {
      await renderRoomChat(withoutRealtime(fixture), testQueryClient());

      const timeline = await screen.findByLabelText("Room timeline");
      expect(timeline).toHaveAttribute("data-initial-scroll-ready", "true");
      expect(timeline).not.toHaveClass("invisible");
      expect(timeline.scrollTop).toBe(1_000);
    } finally {
      restoreProperty(
        HTMLDivElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
      restoreProperty(
        HTMLDivElement.prototype,
        "scrollHeight",
        originalScrollHeight,
      );
    }
  });

  it("keeps a realtime Message that arrives while an older page is loading", async () => {
    const fixture = createTestTeamHubRuntime();

    const allMessages = await listRoomMessages(fixture, "room-all");
    let resolveOlder!: (page: TeamHubMessagePage) => void;
    const olderPage = new Promise<TeamHubMessagePage>((resolve) => {
      resolveOlder = resolve;
    });
    const listMessages = vi
      .fn<TestRouteHandler>()
      .mockReturnValueOnce({
        items: allMessages.items.slice(2),
        page: { has_more: true, next_cursor: "older" },
        snapshot_room_seq: allMessages.snapshot_room_seq,
      })
      .mockReturnValueOnce(olderPage);
    fixture.server.on("GET", "/v0/rooms/{roomId}/messages", listMessages);
    const queryClient = testQueryClient();

    await renderRoomChat(withoutRealtime(fixture), queryClient);

    await screen.findByText(/Keep the first release focused/);
    const timeline = screen.getByLabelText("Room timeline");
    Object.defineProperty(timeline, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(timeline, "scrollHeight", {
      configurable: true,
      value: 400,
    });
    timeline.scrollTop = 0;
    fireEvent.scroll(timeline);
    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(2));
    appendCommittedMessage(queryClient, {
      ...message("message-realtime", "Arrived during pagination"),
      // Newer than fixture room-all messages so reconcile keeps it across page merge.
      created_at: "2026-08-12T12:00:00Z",
    });
    await waitFor(() =>
      expect(screen.getByText("Arrived during pagination")).toBeVisible(),
    );

    resolveOlder({
      items: allMessages.items.slice(0, 2),
      page: { has_more: false },
      snapshot_room_seq: allMessages.snapshot_room_seq,
    });

    await screen.findByText(/I moved the launch notes/);
    expect(screen.getByText("Arrived during pagination")).toBeVisible();
    expect(screen.getAllByText("Arrived during pagination")).toHaveLength(1);
  });

  it("follows new Messages only while the reader remains near the bottom", async () => {
    const fixture = createTestTeamHubRuntime();

    const runtime = withoutRealtime(fixture);
    const queryClient = testQueryClient();

    await renderRoomChat(runtime, queryClient);

    const timeline = await screen.findByLabelText("Room timeline");
    let scrollHeight = 500;
    Object.defineProperty(timeline, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(timeline, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    timeline.scrollTop = 100;
    fireEvent.scroll(timeline);

    scrollHeight = 550;
    appendCommittedMessage(queryClient, message("message-new-1", "First"));
    await screen.findByText("First");
    expect(timeline.scrollTop).toBe(100);

    timeline.scrollTop = 345;
    fireEvent.scroll(timeline);
    scrollHeight = 600;
    appendCommittedMessage(queryClient, message("message-new-2", "Second"));
    await screen.findByText("Second");
    await waitFor(() => expect(timeline.scrollTop).toBe(600));
  });
});
