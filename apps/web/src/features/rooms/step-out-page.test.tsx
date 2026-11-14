import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { StepOutPage } from "./step-out-page";

function renderStepOut(roomId: string) {
  const runtime = createTestTeamHubRuntime();
  const calls: { roomId?: string; status?: string }[] = [];
  runtime.server.on(
    "PUT",
    "/v0/rooms/{roomId}/participation",
    ({ body, params }) => {
      const status = (body as { status?: string }).status;
      calls.push({ roomId: params.roomId, status });
      const room = runtime.seed.rooms.find((item) => item.id === params.roomId);
      return { ...room, participation: status };
    },
  );
  const router = createMemoryRouter(
    [
      {
        element: <StepOutPage />,
        path: "/t/:tenantId/rooms/:roomId/step-out",
      },
    ],
    { initialEntries: [`/t/tenant-northstar/rooms/${roomId}/step-out`] },
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
  return calls;
}

describe("Step out", () => {
  it("stops sending until you come back", async () => {
    const calls = renderStepOut("room-all");
    fireEvent.click(await screen.findByRole("button", { name: "Step out" }));
    expect(
      await screen.findByText(
        "You stepped out. New messages will not arrive, and you cannot send, until you come back.",
      ),
    ).toBeVisible();
    expect(calls).toEqual([{ roomId: "room-all", status: "left" }]);
    fireEvent.click(screen.getByRole("button", { name: "Come back" }));
    expect(
      await screen.findByRole("button", { name: "Step out" }),
    ).toBeVisible();
    expect(calls[1]).toEqual({ roomId: "room-all", status: "joined" });
  });

  it("keeps a direct chat from going quiet", async () => {
    renderStepOut("room-dm-codex");
    expect(
      await screen.findByText(
        "This conversation stays with you. Only a regular room can go quiet.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Step out" })).toBeNull();
  });
});
