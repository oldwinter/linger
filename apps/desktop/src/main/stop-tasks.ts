import { randomUUID } from "node:crypto";

import type { components } from "@linger/wire-contracts/teamhub-public/types";

import type { Logger } from "./log.js";

type Schemas = components["schemas"];
type RoomPage = Schemas["RoomPage"];
type RoomRunCancelRequest = Schemas["RoomRunCancelRequest"];
type RoomRunStatusList = Schemas["RoomRunStatusList"];
type TenantRoomActivity = Schemas["TenantRoomActivity"];

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_MAX_ROOMS = 50;
const MAX_CONCURRENCY = 6;

export interface StopActiveRoomRunsOptions {
  readonly serverUrl: string | undefined;
  readonly tenantId: string | undefined;
  // Session cookie header of the signed-in web session. Never logged.
  readonly sessionCookie: (serverUrl: string) => Promise<string | undefined>;
  readonly log: Pick<Logger, "info" | "warn">;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxRooms?: number;
}

export interface StopActiveRoomRunsResult {
  readonly roomsChecked: number;
  readonly runsCancelRequested: number;
}

/**
 * Best-effort cancels queued and running Room Runs through TeamHub when the
 * user confirms "Quit and Stop Tasks", so queued Runs do not resume when the
 * app reopens. Deliberately does not call the background-task cancel endpoint,
 * which enqueues a hidden Meta callback Run; active delegated Task Runs are
 * stopped directly by the Daemon's structured stop-tasks drain instead.
 */
export async function stopActiveRoomRunsBeforeQuit(
  options: StopActiveRoomRunsOptions,
): Promise<StopActiveRoomRunsResult> {
  const { serverUrl, tenantId } = options;
  if (!serverUrl || !tenantId) {
    return { roomsChecked: 0, runsCancelRequested: 0 };
  }
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let roomsChecked = 0;
  let runsCancelRequested = 0;
  try {
    const cookie = await options.sessionCookie(serverUrl);
    if (!cookie) {
      return { roomsChecked: 0, runsCancelRequested: 0 };
    }
    const base = serverUrl.replace(/\/+$/, "");
    const headers = {
      Accept: "application/json",
      Cookie: cookie,
    };

    const roomIds = await discoverCandidateRoomIds(
      fetchFn,
      base,
      tenantId,
      headers,
      controller.signal,
      maxRooms,
    );
    if (roomIds.length === 0) {
      return { roomsChecked: 0, runsCancelRequested: 0 };
    }

    let nextIndex = 0;
    const workerCount = Math.min(MAX_CONCURRENCY, roomIds.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (!controller.signal.aborted) {
          const index = nextIndex;
          nextIndex += 1;
          const roomId = roomIds[index];
          if (!roomId) return;
          roomsChecked += 1;
          const canceled = await cancelActiveRunsInRoom(
            fetchFn,
            base,
            roomId,
            headers,
            controller.signal,
          );
          runsCancelRequested += canceled;
        }
      }),
    );

    options.log.info("desktop.stop_tasks_completed", {
      rooms_checked: roomsChecked,
      runs_cancel_requested: runsCancelRequested,
    });
    return { roomsChecked, runsCancelRequested };
  } catch (error) {
    options.log.warn("desktop.stop_tasks_failed", {
      error: error instanceof Error ? error.message : String(error),
      rooms_checked: roomsChecked,
      runs_cancel_requested: runsCancelRequested,
    });
    return { roomsChecked, runsCancelRequested };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverCandidateRoomIds(
  fetchFn: typeof fetch,
  base: string,
  tenantId: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  maxRooms: number,
): Promise<string[]> {
  const encodedTenant = encodeURIComponent(tenantId);
  const [activityRes, roomsRes] = await Promise.allSettled([
    fetchJson<TenantRoomActivity>(
      fetchFn,
      `${base}/v0/tenants/${encodedTenant}/room-activity`,
      headers,
      signal,
    ),
    fetchJson<RoomPage>(
      fetchFn,
      `${base}/v0/tenants/${encodedTenant}/rooms?limit=${String(maxRooms)}`,
      headers,
      signal,
    ),
  ]);

  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (id: unknown): void => {
    if (
      typeof id !== "string" ||
      !id ||
      seen.has(id) ||
      ordered.length >= maxRooms
    ) {
      return;
    }
    seen.add(id);
    ordered.push(id);
  };

  if (activityRes.status === "fulfilled" && activityRes.value) {
    for (const id of activityRes.value.running_room_ids ?? []) add(id);
  }
  if (roomsRes.status === "fulfilled" && roomsRes.value) {
    for (const room of roomsRes.value.items ?? []) add(room.id);
  }
  return ordered;
}

async function cancelActiveRunsInRoom(
  fetchFn: typeof fetch,
  base: string,
  roomId: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<number> {
  const encodedRoom = encodeURIComponent(roomId);
  const list = await fetchJson<RoomRunStatusList>(
    fetchFn,
    `${base}/v0/rooms/${encodedRoom}/run-statuses`,
    headers,
    signal,
  );
  if (!list) return 0;

  const activeRunIds = (list.items ?? [])
    .filter(
      (item) =>
        item.status === "active" &&
        typeof item.run_id === "string" &&
        item.run_id.length > 0,
    )
    .map((item) => item.run_id);

  if (activeRunIds.length === 0) return 0;

  let canceled = 0;
  await Promise.allSettled(
    activeRunIds.map(async (runId) => {
      const body: RoomRunCancelRequest = {
        request_id: `desktop-quit-${randomUUID()}`,
      };
      const response = await fetchFn(
        `${base}/v0/rooms/${encodedRoom}/runs/${encodeURIComponent(runId)}/cancel`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
      );
      if (response.ok) canceled += 1;
    }),
  );
  return canceled;
}

async function fetchJson<T>(
  fetchFn: typeof fetch,
  url: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<T | undefined> {
  try {
    const response = await fetchFn(url, { method: "GET", headers, signal });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}
