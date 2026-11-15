import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { HandOffPage } from "./hand-off-page";

it("hands a named job to someone else in the room", async () => {
  const runtime = createTestTeamHubRuntime();
  const posts: unknown[] = [];
  runtime.server.on(
    "POST",
    "/v0/tenants/{tenantId}/work-items",
    ({ body, request }) => {
      posts.push({
        body,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      });
      return Response.json({ id: "work-item-handed" }, { status: 201 });
    },
  );
  renderPage(runtime, "/t/tenant-northstar/rooms/room-gtm-launch/hand-off");

  const agent = await screen.findByRole("button", {
    name: "Hand it to Lev8 GTM",
  });
  const person = screen.getByRole("button", { name: "Hand it to Maya Chen" });
  expect(
    screen.queryByRole("button", { name: "Hand it to Jenny Bin" }),
  ).not.toBeInTheDocument();
  expect(agent.compareDocumentPosition(person)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(agent).toBeDisabled();

  fireEvent.change(screen.getByLabelText("What needs doing"), {
    target: { value: "Ship the launch note" },
  });
  expect(agent).toBeEnabled();
  fireEvent.click(agent);

  expect(
    await screen.findByText("Lev8 GTM has it. It waits on the dashboard."),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "See it on the dashboard" }),
  ).toHaveAttribute("href", "/t/tenant-northstar/dashboard/work-item-handed");
  expect(posts).toEqual([
    {
      body: {
        assignee_actor_ids: ["actor-lev8"],
        description: "",
        kind: "issue",
        origin_room_id: "room-gtm-launch",
        priority: "medium",
        title: "Ship the launch note",
      },
      idempotencyKey: expect.any(String),
    },
  ]);
});

it("keeps a thread with its room", async () => {
  const runtime = createTestTeamHubRuntime();
  const parent = runtime.seed.rooms.find((room) => room.id === "room-all");
  runtime.seed.rooms.push({
    ...parent!,
    id: "room-thread",
    kind: "thread",
    name: "A side thread",
    parent_room_id: "room-all",
  });
  renderPage(runtime, "/t/tenant-northstar/rooms/room-thread/hand-off");

  expect(
    await screen.findByText(
      "A thread stays with its room. Hand work off from the room itself.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Hand it to/ }),
  ).not.toBeInTheDocument();
});

function renderPage(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  initialEntry: string,
) {
  const router = createMemoryRouter(
    [
      {
        element: <HandOffPage />,
        path: "/t/:tenantId/rooms/:roomId/hand-off",
      },
    ],
    { initialEntries: [initialEntry] },
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
}
