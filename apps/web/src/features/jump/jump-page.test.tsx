import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import { JumpPage } from "@/features/jump/jump-page";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

function meeting(id: string, path: string): TeamHubMemoryEntry {
  return {
    content: "",
    id,
    kind: "meeting",
    meeting: {
      capture_id: `capture-${id}`,
      recording_document_id: "audio",
      recording_filename: "launch.m4a",
      recording_version_id: "audio-v1",
      started_at: "2026-11-12T15:30:00Z",
      summary_ready: true,
      transcript_document_id: "transcript",
      transcript_version_id: "transcript-v1",
    },
    path,
    summary: "",
    title: path,
    updated_at: "2026-11-12T15:30:00Z",
  };
}

function renderJump() {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
    items:
      query.get("kind") === "meeting"
        ? [meeting("meeting-launch", "Meetings/2026/11/12/Meeting 15-30-00")]
        : [],
  }));
  const router = createMemoryRouter(
    [
      { element: <JumpPage />, path: "/t/:tenantId/jump" },
      {
        element: <p>Opened the room</p>,
        path: "/t/:tenantId/rooms/:roomId/chat",
      },
      {
        element: <p>Opened the meeting</p>,
        path: "/t/:tenantId/library/meetings",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/jump"] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("JumpPage", () => {
  it("opens Another Me, then a meeting, from the same field", async () => {
    const router = renderJump();
    const list = await screen.findByRole("listbox", { name: "Places" });
    expect(
      within(list).getByRole("option", { name: /Another Me/ }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(list).getByRole("link", { name: /Another Me/ }));
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-another-me/chat",
    );
    expect(screen.getByText("Opened the room")).toBeVisible();

    await router.navigate("/t/tenant-northstar/jump");
    const field = await screen.findByRole("combobox", {
      name: "Where do you want to go?",
    });
    fireEvent.change(field, { target: { value: "15:30" } });
    const meeting = await screen.findByRole("option", {
      name: /Nov 12, 15:30/,
    });
    expect(screen.queryByRole("option", { name: /Another Me/ })).toBeNull();
    expect(meeting).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/library/meetings",
    );
    expect(router.state.location.search).toBe("?entry=meeting-launch");
    expect(screen.getByText("Opened the meeting")).toBeVisible();
  });

  it("says when nothing matches", async () => {
    renderJump();
    const field = await screen.findByRole("combobox", {
      name: "Where do you want to go?",
    });
    fireEvent.change(field, { target: { value: "no such place" } });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nothing matches that.",
    );
  });

  it("navigates back on Escape or Back, scrolls active option into view, and keeps healthy places on partial failure", async () => {
    const runtime = createTestTeamHubRuntime();
    let failMeetings = true;
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => {
      if (failMeetings) {
        return teamHubErrorResponse(503, "UNAVAILABLE", "Meetings unavailable");
      }
      return {
        items:
          query.get("kind") === "meeting"
            ? [
                meeting(
                  "meeting-launch",
                  "Meetings/2026/11/12/Meeting 15-30-00",
                ),
              ]
            : [],
      };
    });
    const scrollIntoView = vi.fn();
    defineGlobalProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      writable: true,
    });
    const router = createMemoryRouter(
      [
        { element: <p>Previous page</p>, path: "/t/:tenantId/apps" },
        { element: <JumpPage />, path: "/t/:tenantId/jump" },
      ],
      {
        initialEntries: [
          "/t/tenant-northstar/apps",
          "/t/tenant-northstar/jump",
        ],
      },
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

    const list = await screen.findByRole("listbox", { name: "Places" });
    expect(
      within(list).getByRole("option", { name: /Another Me/ }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Meetings could not be loaded.",
    );

    failMeetings = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await within(list).findByRole("option", { name: /Nov 12, 15:30/ }),
    ).toBeVisible();

    const field = screen.getByRole("combobox", {
      name: "Where do you want to go?",
    });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    fireEvent.keyDown(field, { key: "Escape" });
    expect(await screen.findByText("Previous page")).toBeVisible();

    await router.navigate("/t/tenant-northstar/jump");
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(await screen.findByText("Previous page")).toBeVisible();
  });
});
