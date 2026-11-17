import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpTeamHubClient } from "@/features/teamhub/teamhub-client";
import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMessage,
  TeamHubMessagePinList,
} from "@/features/teamhub/teamhub-types";
import {
  teamHubErrorResponse,
  TeamHubTestServer,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";

import { roomPinsQueryKey, roomPinsQueryOptions } from "../../room-queries";
import { roomMessageUrl } from "../../room-routes";
import { MessageTimeline } from "../message-timeline";
import { PinnedMessagesControl } from "./pinned-messages-control";
import { useMessagePinToggle } from "./use-message-pin-toggle";

const messagePath = "/v0/rooms/{roomId}/messages/{messageId}/pin" as const;
const pinsPath = "/v0/rooms/{roomId}/pins" as const;

function message(overrides: Partial<TeamHubMessage> = {}): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Alice",
      id: "human-1",
      kind: "human",
      tenant_id: "tenant-1",
    },
    created_at: "2026-10-09T08:00:00.000Z",
    id: "message-1",
    message_kind: "conversation",
    raw_message: "Freeze the release",
    room_id: "room-1",
    segments: [{ type: "text", content: "Freeze the release" }],
    tenant_id: "tenant-1",
    ...overrides,
  };
}

function pinList(items: TeamHubMessagePinList["items"]): TeamHubMessagePinList {
  return { items };
}

function testRuntime(client: TeamHubRuntime["client"]): TeamHubRuntime {
  return {
    client,
    events: {} as TeamHubRuntime["events"],
    runStatuses: {} as TeamHubRuntime["runStatuses"],
  };
}

function setup(routes: (server: TeamHubTestServer) => void) {
  const server = new TeamHubTestServer();
  routes(server);
  const client = createHttpTeamHubClient({
    fetchRequest: server.fetch,
    onAuthenticationRequired: () => undefined,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { client, queryClient, server };
}

function wrapper(queryClient: QueryClient, client: TeamHubRuntime["client"]) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={testRuntime(client)}>
        {children}
      </TeamHubRuntimeProvider>
    </QueryClientProvider>
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("PinnedMessagesControl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { width: 320, height: 640, anchorLeft: 185, pinCount: 0 },
    { width: 390, height: 640, anchorLeft: 225, pinCount: 30 },
    { width: 768, height: 240, anchorLeft: 600, pinCount: 30 },
    { width: 1440, height: 900, anchorLeft: 950, pinCount: 0 },
  ])(
    "keeps $pinCount pins within a $width by $height viewport",
    async ({ width, height, anchorLeft, pinCount }) => {
      vi.stubGlobal("innerWidth", width);
      vi.stubGlobal("innerHeight", height);
      const { client, queryClient } = setup((server) =>
        server.on("GET", pinsPath, () =>
          pinList(
            Array.from({ length: pinCount }, (_, index) => ({
              message: message({
                id: `message-${index}`,
                raw_message: `Pinned message ${index}`,
              }),
              pinned_at: "2026-10-09T08:00:00.000Z",
              pinned_by_actor_id: "human-1",
            })),
          ),
        ),
      );
      const onJump = vi.fn();
      render(
        <header>
          <PinnedMessagesControl
            onJump={onJump}
            roomId="room-1"
            roomName="Design"
            tenantId="tenant-1"
          />
        </header>,
        { wrapper: wrapper(queryClient, client) },
      );
      const trigger = screen.getByRole("button", {
        name: "Pinned messages",
      });
      const anchor = trigger.parentElement!;
      // jsdom has no layout. Model the panel's natural content size and the
      // browser's application of the viewport limits before measuring it.
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        if (this === anchor) return new DOMRect(anchorLeft, 8, 32, 32);
        if (this.getAttribute("role") === "dialog") {
          return new DOMRect(
            Number.parseFloat(this.style.left) || 0,
            Number.parseFloat(this.style.top) || 0,
            Math.min(
              320,
              Number.parseFloat(this.style.maxWidth) ||
                Number.POSITIVE_INFINITY,
            ),
            Math.min(
              pinCount ? 1200 : 80,
              Number.parseFloat(this.style.maxHeight) ||
                Number.POSITIVE_INFINITY,
            ),
          );
        }
        return new DOMRect();
      });

      fireEvent.click(trigger);
      const panel = screen.getByRole("dialog", { name: "Pinned messages" });
      if (pinCount) {
        const rows = await within(panel).findAllByRole("listitem");
        expect(rows).toHaveLength(pinCount);
        fireEvent.pointerDown(rows.at(-1)!);
        expect(panel).toBeInTheDocument();
      } else {
        await within(panel).findByText("No pinned messages yet.");
      }
      const bounds = panel.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(8);
      expect(bounds.right).toBeLessThanOrEqual(width - 8);
      expect(bounds.top).toBeGreaterThanOrEqual(8);
      expect(bounds.bottom).toBeLessThanOrEqual(height - 8);
      expect(panel).toHaveFocus();
      expect(anchor).not.toContainElement(panel);

      if (pinCount) {
        fireEvent.click(
          within(within(panel).getAllByRole("listitem").at(-1)!).getByRole(
            "button",
            { name: "Go to message" },
          ),
        );
        expect(onJump).toHaveBeenCalledWith(`message-${pinCount - 1}`);
        expect(panel).not.toBeInTheDocument();
      } else {
        fireEvent.click(
          within(panel).getByRole("button", { name: "Close pinned messages" }),
        );
        expect(panel).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
      }
    },
  );

  it("follows header and viewport changes without resubscribing while filtering", async () => {
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    const callbacks: Array<() => void> = [];
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, () =>
        pinList([
          {
            message: message(),
            pinned_at: "2026-10-09T08:00:00.000Z",
            pinned_by_actor_id: "human-1",
          },
        ]),
      ),
    );
    const view = render(
      <header>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </header>,
      { wrapper: wrapper(queryClient, client) },
    );
    const trigger = screen.getByRole("button", { name: "Pinned messages" });
    const anchor = trigger.parentElement!;
    let anchorLeft = 500;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === anchor) return new DOMRect(anchorLeft, 8, 32, 32);
        return new DOMRect(
          0,
          0,
          Math.min(
            320,
            Number.parseFloat(this.style.maxWidth) || Number.POSITIVE_INFINITY,
          ),
          180,
        );
      },
    );
    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Pinned messages" });
    const search = await within(panel).findByRole("searchbox");
    expect(panel).toHaveStyle({ left: "212px" });
    expect(observe).toHaveBeenCalledWith(screen.getByRole("banner"));
    expect(callbacks).toHaveLength(1);

    search.focus();
    fireEvent.change(search, { target: { value: "release" } });
    expect(callbacks).toHaveLength(1);
    anchorLeft = 400;
    act(() => callbacks[0]!());
    expect(panel).toHaveStyle({ left: "112px" });
    expect(search).toHaveFocus();

    vi.stubGlobal("innerWidth", 320);
    anchorLeft = 200;
    fireEvent.resize(window);
    expect(panel).toHaveStyle({ left: "8px", maxWidth: "304px" });
    expect(callbacks).toHaveLength(1);
    expect(disconnect).not.toHaveBeenCalled();

    fireEvent.click(
      within(panel).getByRole("button", { name: "Close pinned messages" }),
    );
    expect(disconnect).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    expect(callbacks).toHaveLength(2);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("leaves Escape to a modal opened over the panel", async () => {
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, () => pinList([])),
    );
    render(
      <PinnedMessagesControl
        onJump={vi.fn()}
        roomId="room-1"
        roomName="Design"
        tenantId="tenant-1"
      />,
      { wrapper: wrapper(queryClient, client) },
    );
    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const panel = screen.getByRole("dialog", { name: "Pinned messages" });
    await within(panel).findByText("No pinned messages yet.");
    const modal = document.createElement("dialog");
    modal.open = true;
    document.body.append(modal);
    try {
      const escape = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      fireEvent(modal, escape);
      expect(escape.defaultPrevented).toBe(false);
      expect(panel).toBeInTheDocument();
    } finally {
      modal.remove();
    }

    const escape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    fireEvent(panel, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(panel).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pinned messages" }),
    ).toHaveFocus();
  });

  it("lists pinned Messages newest first and jumps to one", async () => {
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, () =>
        pinList([
          {
            message: message({ id: "message-2", raw_message: "Ship it" }),
            pinned_at: "2026-10-10T08:00:00.000Z",
            pinned_by_actor_id: "human-2",
          },
          {
            message: message(),
            pinned_at: "2026-10-09T08:00:00.000Z",
            pinned_by_actor_id: "human-1",
          },
        ]),
      ),
    );
    const onJump = vi.fn();
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={onJump}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const rows = await within(dialog).findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ship it"),
      expect.stringContaining("Freeze the release"),
    ]);
    fireEvent.click(
      within(rows[0]!).getByRole("button", { name: "Go to message" }),
    );
    expect(onJump).toHaveBeenCalledWith("message-2");
    expect(
      screen.queryByRole("dialog", { name: "Pinned messages" }),
    ).toBeNull();
  });

  it("says so when the Room has no pinned Messages", async () => {
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, () => pinList([])),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    expect(
      await screen.findByText("No pinned messages yet."),
    ).toBeInTheDocument();
  });

  it("unpins an entry and updates the shared Pinned list", async () => {
    let pins: TeamHubMessagePinList["items"] = [
      {
        message: message({ id: "message-2", raw_message: "Ship it" }),
        pinned_at: "2026-10-10T08:00:00.000Z",
        pinned_by_actor_id: "human-2",
      },
      {
        message: message(),
        pinned_at: "2026-10-09T08:00:00.000Z",
        pinned_by_actor_id: "human-1",
      },
    ];
    const deletePin = vi.fn<TestRouteHandler>(({ params }) => {
      pins = pins.filter((pin) => pin.message.id !== params.messageId);
      return undefined;
    });
    const { client, queryClient } = setup((server) =>
      server
        .on("GET", pinsPath, () => pinList(pins))
        .on("DELETE", messagePath, deletePin),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const rows = await within(dialog).findAllByRole("listitem");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Unpin" }));

    await waitFor(() =>
      expect(within(dialog).queryByText("Ship it")).toBeNull(),
    );
    expect(deletePin).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { roomId: "room-1", messageId: "message-2" },
      }),
    );
    expect(within(dialog).getByText("Freeze the release")).toBeInTheDocument();
    // The Room header reads the same query, so its pinned count follows.
    expect(
      queryClient.getQueryData<TeamHubMessagePinList>(
        roomPinsQueryKey("tenant-1", "room-1"),
      )?.items,
    ).toHaveLength(1);
  });

  it("blocks a second Unpin click while the request is in flight", async () => {
    const gate = deferred();
    let pins: TeamHubMessagePinList["items"] = [
      {
        message: message({ raw_message: "Ship it" }),
        pinned_at: "2026-10-09T08:00:00.000Z",
        pinned_by_actor_id: "human-1",
      },
    ];
    const deletePin = vi.fn<TestRouteHandler>(({ params }) => {
      pins = pins.filter((pin) => pin.message.id !== params.messageId);
      return gate.promise;
    });
    const { client, queryClient } = setup((server) =>
      server
        .on("GET", pinsPath, () => pinList(pins))
        .on("DELETE", messagePath, deletePin),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const rows = await within(dialog).findAllByRole("listitem");
    const unpinButton = within(rows[0]!).getByRole("button", {
      name: "Unpin",
    });
    fireEvent.click(unpinButton);

    await waitFor(() => expect(unpinButton).toBeDisabled());
    fireEvent.click(unpinButton);
    expect(deletePin).toHaveBeenCalledTimes(1);

    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(within(dialog).queryByText("Ship it")).toBeNull(),
    );
  });

  it("keeps the entry and says so when unpinning fails", async () => {
    const deletePin = vi.fn<TestRouteHandler>(() =>
      teamHubErrorResponse(503, "PIN_UNAVAILABLE"),
    );
    const { client, queryClient } = setup((server) =>
      server
        .on("GET", pinsPath, () =>
          pinList([
            {
              message: message({ raw_message: "Ship it" }),
              pinned_at: "2026-10-09T08:00:00.000Z",
              pinned_by_actor_id: "human-1",
            },
          ]),
        )
        .on("DELETE", messagePath, deletePin),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const rows = await within(dialog).findAllByRole("listitem");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Unpin" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Could not unpin the message.",
    );
    expect(deletePin).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText("Ship it")).toBeInTheDocument();
    expect(
      within(within(dialog).getAllByRole("listitem")[0]!).getByRole("button", {
        name: "Unpin",
      }),
    ).toBeEnabled();
  });
  it("narrows the pinned list by text and author with a highlighted count", async () => {
    const getPins = vi.fn<TestRouteHandler>(() =>
      pinList([
        {
          message: message({
            id: "message-2",
            raw_message: "Ship it",
            author: {
              display_name: "Bob",
              id: "human-2",
              kind: "human",
              tenant_id: "tenant-1",
            },
          }),
          pinned_at: "2026-10-11T08:00:00.000Z",
          pinned_by_actor_id: "human-2",
        },
        {
          message: message(),
          pinned_at: "2026-10-10T08:00:00.000Z",
          pinned_by_actor_id: "human-1",
        },
        {
          message: message({
            id: "message-3",
            raw_message: "Q4 roadmap review",
          }),
          pinned_at: "2026-10-09T08:00:00.000Z",
          pinned_by_actor_id: "human-1",
        },
      ]),
    );
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, getPins),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    expect(await within(dialog).findAllByRole("listitem")).toHaveLength(3);

    const field = within(dialog).getByRole("searchbox", {
      name: "Search pinned messages",
    });
    fireEvent.change(field, { target: { value: "SHIP" } });

    const rows = within(dialog).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Ship it");
    expect(rows[0]!.querySelector("mark")?.textContent).toBe("Ship");
    expect(within(dialog).getByText("1 of 3")).toBeVisible();
    // Filtering is view state; it never rereads the Room's pins.
    expect(getPins).toHaveBeenCalledTimes(1);

    fireEvent.change(field, { target: { value: "bob" } });
    expect(within(dialog).getAllByRole("listitem")[0]).toHaveTextContent(
      "Ship it",
    );
    expect(within(dialog).getByText("1 of 3")).toBeVisible();
  });

  it("says when no pin matches and clearing restores the list and its scroll", async () => {
    const pins = [1, 2, 3, 4].map((index) => ({
      message: message({
        id: `message-${index}`,
        raw_message: `Release note ${index}`,
      }),
      pinned_at: `2026-10-0${index}T08:00:00.000Z`,
      pinned_by_actor_id: "human-1",
    }));
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, () => pinList(pins)),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const list = await within(dialog).findAllByRole("listitem");
    expect(list).toHaveLength(4);
    const scroller = dialog.querySelector<HTMLElement>(".workspace-scrollbar")!;
    scroller.scrollTop = 40;
    fireEvent.scroll(scroller);

    const field = within(dialog).getByRole("searchbox", {
      name: "Search pinned messages",
    });
    fireEvent.change(field, { target: { value: "absent phrase" } });

    expect(
      await within(dialog).findByText(/No pinned messages match/u),
    ).toBeVisible();
    expect(within(dialog).queryAllByRole("listitem")).toHaveLength(0);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear search" }),
    );

    expect(field).toHaveValue("");
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("Release note 1"),
      expect.stringContaining("Release note 2"),
      expect.stringContaining("Release note 3"),
      expect.stringContaining("Release note 4"),
    ]);
    expect(dialog.querySelector<HTMLElement>(".workspace-scrollbar")).toBe(
      scroller,
    );
    expect(scroller.scrollTop).toBe(40);
  });

  it("resets the filter when the panel closes", async () => {
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, () =>
        pinList([
          {
            message: message({ id: "message-2", raw_message: "Ship it" }),
            pinned_at: "2026-10-10T08:00:00.000Z",
            pinned_by_actor_id: "human-2",
          },
          {
            message: message(),
            pinned_at: "2026-10-09T08:00:00.000Z",
            pinned_by_actor_id: "human-1",
          },
        ]),
      ),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    let dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    await within(dialog).findAllByRole("listitem");
    fireEvent.change(
      within(dialog).getByRole("searchbox", {
        name: "Search pinned messages",
      }),
      { target: { value: "ship" } },
    );
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close pinned messages" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Pinned messages" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    dialog = await screen.findByRole("dialog", { name: "Pinned messages" });
    expect(
      await within(dialog).findByRole("searchbox", {
        name: "Search pinned messages",
      }),
    ).toHaveValue("");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  });

  it("resets the filter when the Room changes", async () => {
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, ({ params }) =>
        params.roomId === "room-2"
          ? pinList([
              {
                message: message({
                  id: "message-9",
                  raw_message: "Quarterly plan",
                  room_id: "room-2",
                }),
                pinned_at: "2026-10-12T08:00:00.000Z",
                pinned_by_actor_id: "human-1",
              },
            ])
          : pinList([
              {
                message: message({ id: "message-2", raw_message: "Ship it" }),
                pinned_at: "2026-10-10T08:00:00.000Z",
                pinned_by_actor_id: "human-2",
              },
            ]),
      ),
    );
    const view = (roomId: string) => (
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={vi.fn()}
          roomId={roomId}
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>
    );
    const { rerender } = render(view("room-1"), {
      wrapper: wrapper(queryClient, client),
    });

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    let dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    await within(dialog).findAllByRole("listitem");
    fireEvent.change(
      within(dialog).getByRole("searchbox", {
        name: "Search pinned messages",
      }),
      { target: { value: "ship" } },
    );
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);

    rerender(view("room-2"));

    dialog = await screen.findByRole("dialog", { name: "Pinned messages" });
    expect(
      await within(dialog).findByRole("searchbox", {
        name: "Search pinned messages",
      }),
    ).toHaveValue("");
    expect(await within(dialog).findByText("Quarterly plan")).toBeVisible();
  });

  it("unpins and jumps from a filtered list", async () => {
    let pins: TeamHubMessagePinList["items"] = [
      {
        message: message({ id: "message-2", raw_message: "Ship it" }),
        pinned_at: "2026-10-10T08:00:00.000Z",
        pinned_by_actor_id: "human-2",
      },
      {
        message: message(),
        pinned_at: "2026-10-09T08:00:00.000Z",
        pinned_by_actor_id: "human-1",
      },
    ];
    const deletePin = vi.fn<TestRouteHandler>(({ params }) => {
      pins = pins.filter((pin) => pin.message.id !== params.messageId);
      return undefined;
    });
    const onJump = vi.fn();
    const { client, queryClient } = setup((server) =>
      server
        .on("GET", pinsPath, () => pinList(pins))
        .on("DELETE", messagePath, deletePin),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={onJump}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    let dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    await within(dialog).findAllByRole("listitem");
    const field = within(dialog).getByRole("searchbox", {
      name: "Search pinned messages",
    });
    fireEvent.change(field, { target: { value: "ship" } });

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Go to message" }),
    );
    expect(onJump).toHaveBeenCalledWith("message-2");

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    dialog = await screen.findByRole("dialog", { name: "Pinned messages" });
    await within(dialog).findAllByRole("listitem");
    fireEvent.change(
      within(dialog).getByRole("searchbox", {
        name: "Search pinned messages",
      }),
      { target: { value: "ship" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpin" }));

    await waitFor(() =>
      expect(deletePin).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { roomId: "room-1", messageId: "message-2" },
        }),
      ),
    );
    // The filter stays on, so the remaining pin no longer matches it.
    expect(
      await within(dialog).findByText(/No pinned messages match/u),
    ).toBeVisible();
    expect(within(dialog).getByText("0 of 1")).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear search" }),
    );
    expect(within(dialog).getByText("Freeze the release")).toBeVisible();
  });
});

describe("Pinned messages copy", () => {
  const alice = message({
    created_at: "2026-10-09T10:00:00",
    id: "message-1",
    raw_message: "Freeze the release",
  });
  const bob = message({
    author: {
      display_name: "Bob",
      id: "human-2",
      kind: "human",
      tenant_id: "tenant-1",
    },
    created_at: "2026-10-10T11:30:00",
    id: "message-2",
    raw_message: "Ship it",
  });

  function pinned(messageItem: TeamHubMessage, pinnedAt: string) {
    return {
      message: messageItem,
      pinned_at: pinnedAt,
      pinned_by_actor_id: "human-1",
    };
  }

  function link(messageId: string) {
    return `${window.location.origin}/t/tenant-1/rooms/room-1/chat?message=${messageId}`;
  }

  function renderControl(getPins: TestRouteHandler, onJump = vi.fn()) {
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, getPins),
    );
    render(
      <MemoryRouter>
        <PinnedMessagesControl
          onJump={onJump}
          roomId="room-1"
          roomName="Design"
          tenantId="tenant-1"
        />
      </MemoryRouter>,
      { wrapper: wrapper(queryClient, client) },
    );
    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
  }

  function mockClipboard(writeText: () => Promise<void>) {
    const mock = vi.fn(writeText);
    Object.assign(navigator, { clipboard: { writeText: mock } });
    return mock;
  }

  it("copies every listed pin as one Markdown document", async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    renderControl(() =>
      pinList([
        pinned(bob, "2026-10-10T08:00:00.000Z"),
        pinned(alice, "2026-10-09T08:00:00.000Z"),
      ]),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    await within(dialog).findAllByRole("listitem");

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy pins" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "# Pinned messages in Design",
          "",
          "**Bob, 2026-10-10 11:30**",
          "Ship it",
          link("message-2"),
          "",
          "**Alice, 2026-10-09 10:00**",
          "Freeze the release",
          link("message-1"),
        ].join("\n"),
      ),
    );
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Copied",
    );
  });

  it("copies only the link of the pin whose row asked", async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    const onJump = vi.fn();
    renderControl(
      () =>
        pinList([
          pinned(bob, "2026-10-10T08:00:00.000Z"),
          pinned(alice, "2026-10-09T08:00:00.000Z"),
        ]),
      onJump,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const rows = await within(dialog).findAllByRole("listitem");
    // The row copies the same absolute link Copy pins writes for that Message.
    const expected = roomMessageUrl(window.location.origin, "tenant-1", bob);
    expect(expected).toBe(link("message-2"));

    fireEvent.click(
      within(rows[0]!).getByRole("button", {
        name: "Copy link to this message",
      }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(await within(rows[0]!).findByRole("status")).toHaveTextContent(
      "Copied",
    );
    // Copying stays in the panel and in place, so the row's other actions work.
    expect(onJump).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Freeze the release")).toBeVisible();
    expect(
      within(rows[1]!).getByRole("button", { name: "Unpin" }),
    ).toBeEnabled();

    fireEvent.click(
      within(rows[0]!).getByRole("button", { name: "Go to message" }),
    );
    expect(onJump).toHaveBeenCalledWith("message-2");
  });

  it("says so in the row when the clipboard refuses a link", async () => {
    mockClipboard(() => Promise.reject(new Error("Clipboard is unavailable")));
    renderControl(() => pinList([pinned(alice, "2026-10-09T08:00:00.000Z")]));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const rows = await within(dialog).findAllByRole("listitem");

    fireEvent.click(
      within(rows[0]!).getByRole("button", {
        name: "Copy link to this message",
      }),
    );

    expect(await within(rows[0]!).findByRole("alert")).toHaveTextContent(
      "Copy failed",
    );
    // A refused copy leaves the pin and its actions alone.
    expect(within(rows[0]!).getByText("Freeze the release")).toBeVisible();
    expect(
      within(rows[0]!).getByRole("button", { name: "Unpin" }),
    ).toBeEnabled();
  });

  it("copies only the pins the filter shows", async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    renderControl(() =>
      pinList([
        pinned(bob, "2026-10-10T08:00:00.000Z"),
        pinned(alice, "2026-10-09T08:00:00.000Z"),
      ]),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    await within(dialog).findAllByRole("listitem");
    fireEvent.change(
      within(dialog).getByRole("searchbox", {
        name: "Search pinned messages",
      }),
      { target: { value: "ship" } },
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy pins" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "# Pinned messages in Design",
          "",
          "**Bob, 2026-10-10 11:30**",
          "Ship it",
          link("message-2"),
        ].join("\n"),
      ),
    );
  });

  it("stays disabled while the pins are loading and when none exist", async () => {
    let resolvePins!: (value: TeamHubMessagePinList) => void;
    const pending = new Promise<TeamHubMessagePinList>((resolve) => {
      resolvePins = resolve;
    });
    renderControl(() => pending);
    const loadingDialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    const loadingCopy = within(loadingDialog).getByRole("button", {
      name: "Copy pins",
    });
    expect(loadingCopy).toBeDisabled();

    await act(async () =>
      resolvePins(pinList([pinned(alice, "2026-10-09T08:00:00.000Z")])),
    );
    await waitFor(() => expect(loadingCopy).toBeEnabled());

    cleanup();
    renderControl(() => pinList([]));
    const emptyDialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    expect(
      await within(emptyDialog).findByText("No pinned messages yet."),
    ).toBeVisible();
    expect(
      within(emptyDialog).getByRole("button", { name: "Copy pins" }),
    ).toBeDisabled();
  });

  it("says so when the clipboard refuses the copy", async () => {
    mockClipboard(() => Promise.reject(new Error("Clipboard is unavailable")));
    renderControl(() => pinList([pinned(alice, "2026-10-09T08:00:00.000Z")]));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    await within(dialog).findAllByRole("listitem");

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy pins" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Copy failed",
    );
  });

  it("clears the search query on Escape first and restores trigger focus on close", async () => {
    renderControl(() => pinList([pinned(alice, "2026-10-09T08:00:00.000Z")]));
    const dialog = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    await within(dialog).findAllByRole("listitem");
    const search = within(dialog).getByRole("searchbox", {
      name: "Search pinned messages",
    });
    fireEvent.change(search, { target: { value: "hi" } });
    search.focus();

    const firstEscape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    fireEvent(search, firstEscape);
    expect(firstEscape.defaultPrevented).toBe(true);
    expect(search).toHaveValue("");
    expect(
      screen.getByRole("dialog", { name: "Pinned messages" }),
    ).toBeVisible();

    const secondEscape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    fireEvent(document, secondEscape);
    expect(secondEscape.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Pinned messages" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Pinned messages" }),
    ).toHaveFocus();
  });
});

describe("useMessagePinToggle", () => {
  it("pins a Message and rereads the Room's Pinned list", async () => {
    const getPins = vi.fn<TestRouteHandler>(() => pinList([]));
    const putPin = vi.fn<TestRouteHandler>(() => undefined);
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, getPins).on("PUT", messagePath, putPin),
    );
    const { result } = renderHook(
      () => ({
        pins: useQuery(roomPinsQueryOptions(client, "tenant-1", "room-1")),
        toggle: useMessagePinToggle({
          client,
          queryClient,
          roomId: "room-1",
          tenantId: "tenant-1",
        }),
      }),
      { wrapper: wrapper(queryClient, client) },
    );
    await waitFor(() => expect(result.current.pins.isSuccess).toBe(true));

    await act(async () => {
      await result.current.toggle(message(), false);
    });
    expect(putPin).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { roomId: "room-1", messageId: "message-1" },
      }),
    );
    await waitFor(() => expect(getPins).toHaveBeenCalledTimes(2));
  });

  it("unpins a Message idempotently and rereads the list", async () => {
    const getPins = vi.fn<TestRouteHandler>(() => pinList([]));
    const deletePin = vi.fn<TestRouteHandler>(() => undefined);
    const { client, queryClient } = setup((server) =>
      server.on("GET", pinsPath, getPins).on("DELETE", messagePath, deletePin),
    );
    const { result } = renderHook(
      () => ({
        pins: useQuery(roomPinsQueryOptions(client, "tenant-1", "room-1")),
        toggle: useMessagePinToggle({
          client,
          queryClient,
          roomId: "room-1",
          tenantId: "tenant-1",
        }),
      }),
      { wrapper: wrapper(queryClient, client) },
    );
    await waitFor(() => expect(result.current.pins.isSuccess).toBe(true));

    await act(async () => {
      await result.current.toggle(message(), true);
    });
    expect(deletePin).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { roomId: "room-1", messageId: "message-1" },
      }),
    );
    await waitFor(() => expect(getPins).toHaveBeenCalledTimes(2));
  });
});

describe("Message Pin action", () => {
  function renderTimeline(
    props: Partial<ComponentProps<typeof MessageTimeline>> = {},
  ) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <MessageTimeline
            actorDisplayNames={{ "human-1": "Alice" }}
            actorKinds={{ "human-1": "human" }}
            canLoadOlder={false}
            currentActorId="human-1"
            loadingOlder={false}
            messages={[message()]}
            onCancel={vi.fn()}
            onCardDecision={vi.fn()}
            onCloseLinkedSource={vi.fn()}
            onOpenArtifact={vi.fn()}
            onOpenMessageFile={vi.fn()}
            onOpenProfile={vi.fn()}
            onRetry={vi.fn()}
            pendingMessages={[]}
            presentations={{}}
            tenantId="tenant-1"
            {...props}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("pins and unpins from the message action menu", async () => {
    const onTogglePin = vi.fn().mockResolvedValue(undefined);
    renderTimeline({ onTogglePin });
    fireEvent.click(
      screen.getByRole("button", { name: "More message actions" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Pin message" }),
    );
    expect(onTogglePin).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
      false,
    );

    renderTimeline({
      onTogglePin,
      pinnedMessageIds: new Set(["message-1"]),
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "More message actions" }).at(-1)!,
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Unpin message" }),
    );
    expect(onTogglePin).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "message-1" }),
      true,
    );
  });
});
