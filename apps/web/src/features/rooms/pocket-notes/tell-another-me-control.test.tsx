import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";

import { PocketNoteLauncher } from "./pocket-note-launcher";

const notes = {
  items: [
    {
      date: "2026-10-01",
      text: "Buy milk",
      updated_at: "2026-10-01T01:00:00Z",
    },
  ],
  page: { has_more: false },
  today: "2026-10-01",
};

function renderNotes() {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/me/pocket-notes",
    () => notes,
  );
  const router = createMemoryRouter(
    [
      {
        element: (
          <PocketNoteLauncher
            anotherMeRoomId="room-another-me"
            tenantId="tenant-northstar"
          />
        ),
        path: "/t/:tenantId/rooms",
      },
      {
        element: <div>Chat</div>,
        path: "/t/:tenantId/rooms/:roomId/chat",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/rooms"] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { router, runtime };
}

describe("Tell Another Me today's note", () => {
  it("saves nothing extra, posts the note once, and opens that chat", async () => {
    const { router, runtime } = renderNotes();
    const keys: string[] = [];
    const post = vi.fn<TestRouteHandler>(({ body, request }) => {
      keys.push(request.headers.get("Idempotency-Key") ?? "");
      expect((body as { raw_message?: string }).raw_message).toBe(
        "From today's Pocket note:\n\nBuy milk",
      );
      return { id: "message-sent" };
    });
    runtime.server.on("POST", "/v0/rooms/{roomId}/messages", post);

    fireEvent.click(screen.getByRole("button", { name: "Pocket Notes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Tell Another Me" }),
    );
    const preview = screen.getByRole("region", { name: "Tell Another Me" });
    expect(preview.textContent).toContain("From today's Pocket note:");
    expect(preview.textContent).toContain("Buy milk");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByRole("heading", { name: "Sent to Another Me" }),
    ).toBeVisible();
    expect(post).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-another-me/chat",
    );
    expect(keys[0]).toBeTruthy();
  });

  it("retries a failed send with the same idempotency key", async () => {
    const { runtime } = renderNotes();
    const keys: string[] = [];
    let failed = true;
    runtime.server.on("POST", "/v0/rooms/{roomId}/messages", ({ request }) => {
      keys.push(request.headers.get("Idempotency-Key") ?? "");
      if (failed) {
        failed = false;
        return teamHubErrorResponse(
          500,
          "MESSAGE_UNAVAILABLE",
          "Could not send.",
        );
      }
      return { id: "message-sent" };
    });

    fireEvent.click(screen.getByRole("button", { name: "Pocket Notes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Tell Another Me" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not send. Try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Sent to Another Me" }),
      ).toBeVisible(),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
