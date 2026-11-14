import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

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
