import { describe, expect, it, vi } from "vitest";

import { stopActiveRoomRunsBeforeQuit } from "./stop-tasks.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("stopActiveRoomRunsBeforeQuit", () => {
  it("cancels queued and running Room Runs without calling background-task cancel", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : String(input);
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });

      if (url.endsWith("/v0/tenants/tenant_1/room-activity")) {
        return jsonResponse({
          running_room_ids: ["room_active"],
          failed_room_ids: [],
        });
      }
      if (url.includes("/v0/tenants/tenant_1/rooms?")) {
        return jsonResponse({
          items: [{ id: "room_active" }, { id: "room_queued" }],
        });
      }
      if (url.endsWith("/v0/rooms/room_active/run-statuses")) {
        return jsonResponse({
          items: [
            { run_id: "run_running", status: "active" },
            { run_id: "run_done", status: "completed" },
          ],
        });
      }
      if (url.endsWith("/v0/rooms/room_queued/run-statuses")) {
        return jsonResponse({
          items: [
            { run_id: "run_queued", status: "active" },
            { run_id: "run_aborted", status: "aborted" },
          ],
        });
      }
      if (url.includes("/runs/") && url.endsWith("/cancel")) {
        return jsonResponse({
          run_id: "ok",
          status: "cancel_requested",
          agent_actor_id: "actor_1",
          message_ids: [],
        });
      }
      return jsonResponse({}, 404);
    });

    const log = { info: vi.fn(), warn: vi.fn() };
    const result = await stopActiveRoomRunsBeforeQuit({
      serverUrl: "http://127.0.0.1:4173/",
      tenantId: "tenant_1",
      sessionCookie: async () => "linger_session=abc",
      fetchImpl,
      log,
    });

    expect(result).toEqual({ roomsChecked: 2, runsCancelRequested: 2 });
    const cancelCalls = calls.filter(
      (call) => call.method === "POST" && call.url.endsWith("/cancel"),
    );
    expect(cancelCalls.map((call) => call.url).sort()).toEqual([
      "http://127.0.0.1:4173/v0/rooms/room_active/runs/run_running/cancel",
      "http://127.0.0.1:4173/v0/rooms/room_queued/runs/run_queued/cancel",
    ]);
    for (const call of cancelCalls) {
      expect(call.body).toEqual({
        request_id: expect.stringMatching(/^desktop-quit-/),
      });
    }
    expect(calls.some((call) => call.url.includes("/background-tasks/"))).toBe(
      false,
    );
    expect(log.info).toHaveBeenCalledWith("desktop.stop_tasks_completed", {
      rooms_checked: 2,
      runs_cancel_requested: 2,
    });
  });

  it("returns cleanly without requests when server, tenant, or session cookie is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(
      stopActiveRoomRunsBeforeQuit({
        serverUrl: undefined,
        tenantId: "tenant_1",
        sessionCookie: async () => "linger_session=abc",
        fetchImpl,
        log,
      }),
    ).resolves.toEqual({ roomsChecked: 0, runsCancelRequested: 0 });

    await expect(
      stopActiveRoomRunsBeforeQuit({
        serverUrl: "http://127.0.0.1:4173",
        tenantId: "tenant_1",
        sessionCookie: async () => undefined,
        fetchImpl,
        log,
      }),
    ).resolves.toEqual({ roomsChecked: 0, runsCancelRequested: 0 });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never throws when requests fail or exceed the timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await stopActiveRoomRunsBeforeQuit({
      serverUrl: "http://127.0.0.1:4173",
      tenantId: "tenant_1",
      sessionCookie: async () => "linger_session=abc",
      fetchImpl,
      log,
      timeoutMs: 25,
    });

    expect(result).toEqual({ roomsChecked: 0, runsCancelRequested: 0 });
  });
});
