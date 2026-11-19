import { createDocumentTestRuntime } from "@/test/document-scenarios";
import {
  acceptRoomMessages,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import {
  type InfiniteData,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

import {
  teamHubData,
  type TeamHubApiPath,
} from "@/features/teamhub/teamhub-api";
import {
  type TeamHubRuntime,
  TeamHubRuntimeProvider,
} from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMessage,
  TeamHubRunStatus,
  TeamHubMessagePage,
} from "@/features/teamhub/teamhub-types";

import {
  roomMembersQueryOptions,
  roomMessagesInfiniteQueryOptions,
  roomMessagesQueryKey,
  roomQueryOptions,
  teamHubIdentityQueryOptions,
} from "../room-queries";
import {
  RoomChromeProvider,
  type RoomOutletContext,
} from "../room-connectivity";

import { RoomChat } from "./room-chat";
import { roomMessageSender } from "./room-message-sender";

export function repliedRunScenario() {
  const fixture = withoutRealtime(createTestTeamHubRuntime());
  let onCollection: ((runStatuses: TeamHubRunStatus[]) => void) | undefined;
  let current: TeamHubRunStatus = {
    agent: { display_name: "Codex", id: "actor-codex", kind: "agent" },
    created_at: "2026-10-20T02:00:00Z",
    id: "run-status-replied",
    replied: false,
    revision: 1,
    room_id: "room-all",
    run_id: "run-replied",
    status: "active",
    updated_at: "2026-10-20T02:00:00Z",
  };
  const createMessage = vi.spyOn(
    roomMessageSender(fixture.client),
    "createMessage",
  );
  const runtime: TeamHubRuntime = {
    ...fixture,
    runStatuses: {
      subscribe(input) {
        onCollection = input.onCollection;
        input.onCollection([current]);
        return () => {
          onCollection = undefined;
        };
      },
    },
  };
  return {
    createMessage,
    publish(change: Partial<TeamHubRunStatus>) {
      current = { ...current, ...change };
      act(() => onCollection?.([current]));
    },
    runtime,
  };
}

// Panel opens from message entities go to this spy; the rest is the standalone
// Chat context.
export const openPanelTab = vi.fn<RoomOutletContext["openPanelTab"]>();
export const openRoomSearch =
  vi.fn<NonNullable<RoomOutletContext["openRoomSearch"]>>();

const testRoomChrome: RoomOutletContext = {
  focusPanelMessageId: null,
  lastAppliedRoomSeq: 0,
  messagePresentations: {},
  openPanelTab,
  openProfile: () => undefined,
  openRoomSearch,
  recordMessagePresentation: () => undefined,
  status: "connected",
};

export function TestRoomChrome({ children }: { children: ReactNode }) {
  return (
    <RoomChromeProvider value={testRoomChrome}>{children}</RoomChromeProvider>
  );
}

// Loading what RoomChat suspends on before rendering skips React's Suspense
// reveal throttle, which otherwise costs every test a fixed delay.
export async function renderRoomChat(
  runtime: TeamHubRuntime,
  queryClient: QueryClient,
  initialEntry = "/t/tenant-northstar/rooms/room-all/chat",
  focusComposer = false,
) {
  const [, tenantId = "", roomId = ""] =
    /^\/t\/([^/]+)\/rooms\/([^/]+)/.exec(initialEntry) ?? [];
  // A failed load stays in the cache so RoomChat surfaces it as before.
  await preloadRoomChat(runtime, queryClient, tenantId, roomId).catch(
    () => undefined,
  );
  const router = createMemoryRouter(
    [
      {
        element: <RoomChat />,
        path: "/t/:tenantId/rooms/:roomId/chat",
      },
      {
        element: <p>Unified Document</p>,
        path: "/t/:tenantId/documents/:documentId",
      },
      {
        element: <p>Work Item dashboard</p>,
        path: "/t/:tenantId/dashboard/:workItemId",
      },
    ],
    {
      initialEntries: [
        focusComposer
          ? { pathname: initialEntry, state: { focusComposer: true } }
          : initialEntry,
      ],
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

  return router;
}

export function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }
  Reflect.deleteProperty(target, key);
}

export function createTestStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

export function withoutRealtime(runtime: TeamHubRuntime): TeamHubRuntime {
  return {
    ...runtime,
    events: {
      ...runtime.events,
      subscribeRoom(input) {
        input.onStatusChange?.("connected");
        return () => undefined;
      },
    },
  };
}

export function appendCommittedMessage(
  queryClient: QueryClient,
  nextMessage: TeamHubMessage,
) {
  act(() => {
    queryClient.setQueryData<InfiniteData<TeamHubMessagePage>>(
      roomMessagesQueryKey("tenant-northstar", "room-all"),
      (current) => {
        if (!current?.pages[0]) {
          return current;
        }

        return {
          ...current,
          pages: [
            {
              ...current.pages[0],
              items: [...current.pages[0].items, nextMessage],
            },
            ...current.pages.slice(1),
          ],
        };
      },
    );
  });
}

export function message(id: string, body: string): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Codex",
      id: "actor-codex",
      kind: "agent",
      tenant_id: "tenant-northstar",
    },
    created_at: "2026-07-23T10:00:00Z",
    id,
    message_kind: "conversation",
    raw_message: body,
    room_id: "room-all",
    segments: [{ content: body, type: "text" }],
    tenant_id: "tenant-northstar",
  };
}

export function presentedAttachment(available: boolean) {
  return {
    document: {
      current_version: { id: "version-1" },
      id: "document-1",
      title: "report.txt",
    },
    available,
    filename: "report.txt",
    id: "attachment-1",
    mediaType: "text/plain",
    sizeBytes: 12,
  };
}

// These two tests start after required Room data, while Actor and Run Status reads
// still start through their real mounted query and transport paths.
export async function loadedRoomChatQueryClient(runtime: TeamHubRuntime) {
  const queryClient = testQueryClient();
  await preloadRoomChat(runtime, queryClient, "tenant-northstar", "room-all");
  return queryClient;
}

async function preloadRoomChat(
  runtime: TeamHubRuntime,
  queryClient: QueryClient,
  tenantId: string,
  roomId: string,
) {
  await Promise.all([
    queryClient.ensureInfiniteQueryData(
      roomMessagesInfiniteQueryOptions(runtime.client, tenantId, roomId),
    ),
    queryClient.ensureQueryData(
      roomQueryOptions(runtime.client, tenantId, roomId),
    ),
    queryClient.ensureQueryData(
      roomMembersQueryOptions(runtime.client, tenantId, roomId),
    ),
    queryClient.ensureQueryData(teamHubIdentityQueryOptions(runtime.client)),
  ]);
}

export function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

export function createTestTeamHubRuntime() {
  const runtime = createDocumentTestRuntime();
  acceptRoomMessages(runtime);
  return runtime;
}

export function readShareableDocuments(runtime: TestTeamHubRuntime) {
  return teamHubData(
    runtime.client.api.GET("/v0/library/documents", {
      params: { query: { limit: 50, view: "shareable" } },
    }),
  );
}

export function queriesTo(runtime: TestTeamHubRuntime, path: TeamHubApiPath) {
  return runtime.server
    .requestsTo("GET", path)
    .map((request) => Object.fromEntries(new URL(request.url).searchParams));
}

/** Serves every Room from the seed with the given Direct Room peer state. */
export function servePeerActive(
  runtime: TestTeamHubRuntime,
  active: boolean | undefined,
) {
  runtime.server.on("GET", "/v0/rooms/{roomId}", ({ params }) => ({
    ...runtime.seed.rooms.find((room) => room.id === params.roomId),
    direct_peer_active: active,
  }));
}

export function readTenantAgents(runtime: TestTeamHubRuntime) {
  return teamHubData(
    runtime.client.api.GET("/v0/tenants/{tenantId}/agents", {
      params: { path: { tenantId: "tenant-northstar" } },
    }),
  );
}

export function readAgentAvailability(runtime: TestTeamHubRuntime) {
  return teamHubData(
    runtime.client.api.GET("/v0/tenants/{tenantId}/agent-availability", {
      params: { path: { tenantId: "tenant-northstar" } },
    }),
  );
}

export function listRoomMessages(runtime: TestTeamHubRuntime, roomId: string) {
  return teamHubData(
    runtime.client.api.GET("/v0/rooms/{roomId}/messages", {
      params: { path: { roomId } },
    }),
  );
}
