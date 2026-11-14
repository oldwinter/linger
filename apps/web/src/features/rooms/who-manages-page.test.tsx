import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  acceptRoomMembers,
  createTestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import type { TestRouteHandler } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { WhoManagesPage } from "./who-manages-page";

function renderPage() {
  const runtime = createTestTeamHubRuntime();
  acceptRoomMembers(runtime);
  const put = vi.fn<TestRouteHandler>(({ body, params }) => {
    const actor = runtime.seed.actors.find(
      (item) => item.id === params.actorId,
    );
    return {
      actor,
      added_by: actor,
      joined_at: "2026-11-14T00:00:00Z",
      role: (body as { role: string }).role,
      room_id: params.roomId,
      updated_at: "2026-11-14T00:00:00Z",
    };
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
});
