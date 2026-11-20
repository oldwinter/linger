import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  acceptRoomMembers,
  createTestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomMember } from "@/features/teamhub/teamhub-types";

import { WhoManagesPage } from "./who-manages-page";

function renderPage(beforePut?: () => Promise<Response | undefined>) {
  const runtime = createTestTeamHubRuntime();
  acceptRoomMembers(runtime);
  const put = vi.fn<TestRouteHandler>(async ({ body, params }) => {
    const response = await beforePut?.();
    if (response) return response;
    const actor = runtime.seed.actors.find(
      (item) => item.id === params.actorId,
    );
    if (
      !actor ||
      !params.roomId ||
      typeof body !== "object" ||
      body === null ||
      !("role" in body) ||
      (body.role !== "owner" && body.role !== "member")
    ) {
      throw new Error("Expected an existing member and a Room role.");
    }
    const member = {
      actor,
      added_by: actor,
      joined_at: "2026-11-14T00:00:00Z",
      role: body.role,
      room_id: params.roomId,
      updated_at: "2026-11-14T00:00:00Z",
    } satisfies TeamHubRoomMember;
    runtime.seed.membersByRoom.set(params.roomId, [
      ...(runtime.seed.membersByRoom.get(params.roomId) ?? []).filter(
        (item) => item.actor.id !== actor.id,
      ),
      member,
    ]);
    return member;
  });
  runtime.server.on("PUT", "/v0/rooms/{roomId}/members/{actorId}", put);
  const router = createMemoryRouter(
    [
      {
        element: <WhoManagesPage />,
        path: "/t/:tenantId/rooms/:roomId/who-manages",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/rooms/room-all/who-manages"] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return put;
}

describe("WhoManagesPage", () => {
  it("lets an owner make someone else able to manage the room", async () => {
    const put = renderPage();
    const maya = await screen.findByRole("group", { name: "Maya Chen" });
    expect(
      within(maya).getByRole("radio", { name: "Takes part" }),
    ).toBeChecked();
    const jenny = screen.getByRole("group", { name: "Jenny Bin" });
    expect(
      within(jenny).getByRole("radio", { name: "Takes part" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Codex takes part. Agents do not manage the room."),
    ).toBeVisible();
    fireEvent.click(within(maya).getByRole("radio", { name: "Can manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Saved. This room will keep that."),
    ).toBeVisible();
    expect(put).toHaveBeenCalledTimes(1);
    const request = put.mock.calls[0]?.[0];
    expect(request?.params).toEqual(
      expect.objectContaining({ actorId: "actor-maya" }),
    );
    expect(request?.body).toEqual({ role: "owner" });
  });

  it("keeps the submitted roles fixed and prevents another save while pending", async () => {
    let finishWrite!: () => void;
    const write = new Promise<undefined>((resolve) => {
      finishWrite = () => resolve(undefined);
    });
    const put = renderPage(() => write);
    const maya = await screen.findByRole("group", { name: "Maya Chen" });
    const manage = within(maya).getByRole("radio", { name: "Can manage" });
    const participate = within(maya).getByRole("radio", {
      name: "Takes part",
    });
    fireEvent.click(manage);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saving = await screen.findByRole("button", { name: "Saving" });

    expect(manage).toBeDisabled();
    expect(participate).toBeDisabled();
    participate.click();
    saving.click();
    fireEvent.submit(saving);
    expect(manage).toBeChecked();
    expect(put).toHaveBeenCalledTimes(1);

    finishWrite();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
    expect(manage).toBeChecked();
    expect(participate).toBeEnabled();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("retains the intended role after a failed save and allows retry", async () => {
    const beforePut = vi
      .fn<() => Promise<Response | undefined>>()
      .mockResolvedValueOnce(
        teamHubErrorResponse(403, "FORBIDDEN", "Permission denied."),
      )
      .mockResolvedValue(undefined);
    const put = renderPage(beforePut);
    const maya = await screen.findByRole("group", { name: "Maya Chen" });
    const manage = within(maya).getByRole("radio", { name: "Can manage" });
    fireEvent.click(manage);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Permission denied.",
    );
    expect(manage).toBeChecked();
    expect(manage).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
    expect(manage).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved. This room will keep that.",
    );
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("uses a semantic section with Back to room at the top and offers Retry on load error", async () => {
    const runtime = createTestTeamHubRuntime();
    let fail = true;
    runtime.server.on("GET", "/v0/rooms/{roomId}/members", () => {
      if (fail) {
        fail = false;
        return teamHubErrorResponse(503, "MEMBERS_UNAVAILABLE");
      }
      return {
        items: runtime.seed.membersByRoom.get("room-all") ?? [],
        page: { has_more: false },
      };
    });
    const router = createMemoryRouter(
      [
        {
          element: <WhoManagesPage />,
          path: "/t/:tenantId/rooms/:roomId/who-manages",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/who-manages"] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Who can manage this room",
    });
    expect(screen.queryByRole("main")).toBeNull();
    const back = screen.getByRole("link", { name: "Back to room" });
    expect(
      back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Who can manage could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("group", { name: "Maya Chen" }),
    ).toBeVisible();
  });

  it("syncs succeeded role updates on partial failure and retries only the failed member", async () => {
    const runtime = createTestTeamHubRuntime();
    acceptRoomMembers(runtime);
    const existing = runtime.seed.membersByRoom.get("room-all") ?? [];
    const alexActor = {
      created_at: "2026-11-14T00:00:00Z",
      display_name: "Alex Rivera",
      id: "actor-alex",
      kind: "human" as const,
      tenant_id: "tenant-northstar",
    };
    runtime.seed.actors.push(alexActor);
    runtime.seed.membersByRoom.set("room-all", [
      ...existing,
      {
        actor: alexActor,
        added_by: alexActor,
        joined_at: "2026-11-14T00:00:00Z",
        role: "member",
        room_id: "room-all",
        updated_at: "2026-11-14T00:00:00Z",
      },
    ]);
    let failAlex = true;
    const put = vi.fn<TestRouteHandler>(({ body, params }) => {
      if (params.actorId === "actor-alex" && failAlex) {
        failAlex = false;
        return teamHubErrorResponse(
          503,
          "WRITE_FAILED",
          "Could not save Alex.",
        );
      }
      const actor = runtime.seed.actors.find(
        (item) => item.id === params.actorId,
      )!;
      const role = (body as { role: "owner" | "member" }).role;
      const member: TeamHubRoomMember = {
        actor,
        added_by: actor,
        joined_at: "2026-11-14T00:00:00Z",
        role,
        room_id: params.roomId!,
        updated_at: "2026-11-14T00:00:00Z",
      };
      runtime.seed.membersByRoom.set(params.roomId!, [
        ...(runtime.seed.membersByRoom.get(params.roomId!) ?? []).filter(
          (item) => item.actor.id !== actor.id,
        ),
        member,
      ]);
      return member;
    });
    runtime.server.on("PUT", "/v0/rooms/{roomId}/members/{actorId}", put);
    const router = createMemoryRouter(
      [
        {
          element: <WhoManagesPage />,
          path: "/t/:tenantId/rooms/:roomId/who-manages",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-all/who-manages"] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    const maya = await screen.findByRole("group", { name: "Maya Chen" });
    const alex = screen.getByRole("group", { name: "Alex Rivera" });
    fireEvent.click(within(maya).getByRole("radio", { name: "Can manage" }));
    fireEvent.click(within(alex).getByRole("radio", { name: "Can manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save Alex.",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(
      within(maya).getByRole("radio", { name: "Can manage" }),
    ).toBeChecked();
    expect(
      within(alex).getByRole("radio", { name: "Can manage" }),
    ).toBeChecked();

    // Retrying sends only Alex because Maya already succeeded and was cleared.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Saved. This room will keep that."),
    ).toBeVisible();
    expect(put.mock.calls.map(([req]) => req.params.actorId)).toEqual([
      "actor-maya",
      "actor-alex",
      "actor-alex",
    ]);
  });
});
