import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { CarryDecisionPage } from "./carry-decision-page";
import { MeetingReader } from "./meeting-reader";

const entry: TeamHubMemoryEntry = {
  content: `## Decisions And Outcomes

- Decision: Ship the web app first.
- Completed: The brief is written.
- Decision: Keep the launch room.
`,
  id: "meeting-launch",
  kind: "meeting",
  meeting: {
    capture_id: "capture-launch",
    recording_document_id: "audio",
    recording_filename: "launch.m4a",
    recording_version_id: "audio-v1",
    started_at: "2026-11-12T15:30:00Z",
    summary_ready: true,
    transcript_document_id: "transcript",
    transcript_version_id: "transcript-v1",
  },
  path: "Meetings/2026/11/12/Meeting 15-30-00",
  summary: "",
  title: "Meeting 15-30-00",
  updated_at: "2026-11-12T16:00:00Z",
};

describe("Carry a decision", () => {
  it("posts the chosen decision into the chosen room", async () => {
    const runtime = createTestTeamHubRuntime();
    const posted: { roomId?: string; text?: string } = {};
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
      items: query.get("kind") === "meeting" ? [entry] : [],
    }));
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/memory/{entryId}",
      () => entry,
    );
    runtime.server.on(
      "POST",
      "/v0/rooms/{roomId}/messages",
      ({ body, params }) => {
        posted.roomId = params.roomId;
        posted.text = (body as { raw_message?: string }).raw_message;
        return { id: "message-sent" };
      },
    );
    const router = createMemoryRouter(
      [
        {
          element: <CarryDecisionPage />,
          path: "/t/:tenantId/library/carry-decision",
        },
        {
          element: <p>Opened the room</p>,
          path: "/t/:tenantId/rooms/:roomId/chat",
        },
      ],
      {
        initialEntries: [
          "/t/tenant-northstar/library/carry-decision?entry=meeting-launch",
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

    fireEvent.click(
      await screen.findByRole("radio", { name: "Keep the launch room." }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "gtm-launch" }));
    fireEvent.click(screen.getByRole("button", { name: "Send it there" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sent to gtm-launch.",
    );
    expect(posted).toEqual({
      roomId: "room-gtm-launch",
      text: "From Meeting · Nov 12, 15:30:\n\nKeep the launch room.",
    });
    expect(
      screen.queryByRole("radio", { name: "Confirm the release." }),
    ).toBeNull();
  });

  it("offers the link from a meeting that has a decision", async () => {
    const runtime = createTestTeamHubRuntime();
    const router = createMemoryRouter(
      [
        {
          element: (
            <MeetingReader
              entry={entry}
              file="summary"
              onHidden={() => undefined}
              onSelectTab={() => undefined}
              tenantId="tenant-northstar"
            />
          ),
          path: "/t/:tenantId/library/meetings",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/library/meetings"] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("link", { name: "Carry a decision" }),
    ).toHaveAttribute(
      "href",
      "/t/tenant-northstar/library/carry-decision?entry=meeting-launch",
    );
  });
});
