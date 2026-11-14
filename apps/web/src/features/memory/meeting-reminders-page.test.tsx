import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import type { TestRouteHandler } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { MeetingRemindersPage } from "./meeting-reminders-page";

const entryId = "meeting_012345678901234567890123";

function entry(content: string): TeamHubMemoryEntry {
  return {
    id: entryId,
    kind: "meeting",
    title: "Meeting 09-05-00",
    path: "Meetings/2026/11/14/Meeting 09-05-00",
    content,
    summary: "",
    updated_at: "2026-11-14T01:05:00Z",
    meeting: {
      capture_id: "capture_meeting",
      started_at: "2026-11-14T01:05:00Z",
      recording_document_id: "audio",
      recording_version_id: "audio_v1",
      recording_filename: "recording.m4a",
      transcript_document_id: "document-meeting-transcript",
      transcript_version_id: "document-meeting-transcript-version-1",
      summary_ready: true,
    },
  };
}

function renderPage(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  content: string,
) {
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
    items: query.get("kind") === "meeting" ? [entry(content)] : [],
  }));
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory/{entryId}", () =>
    entry(content),
  );
  const router = createMemoryRouter(
    [
      {
        element: <MeetingRemindersPage />,
        path: "/t/:tenantId/library/meeting-reminders",
      },
    ],
    {
      initialEntries: [
        `/t/tenant-northstar/library/meeting-reminders?entry=${entryId}`,
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
}

describe("MeetingRemindersPage", () => {
  it("creates a reminder for the to-dos that were kept", async () => {
    const runtime = createTestTeamHubRuntime();
    const create = vi.fn<TestRouteHandler>(({ body }) => {
      created.push(body);
      return { id: "routine_created" };
    });
    const created: unknown[] = [];
    runtime.server.on("POST", "/v0/rooms/{roomId}/routines", create);
    renderPage(
      runtime,
      "## Action Items\n\n- Send the notes\n- Call the client\n",
    );
    expect(
      await screen.findByRole("heading", { name: "Meeting Nov 14, 09:05" }),
    ).toBeVisible();
    fireEvent.change(screen.getAllByLabelText("Remind me")[0]!, {
      target: { value: "2026-11-16T09:30" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Skip Call the client" }),
    );
    expect(screen.getByText("Skipped.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create reminders" }));
    expect(
      await screen.findByText("Another Me will remind you."),
    ).toBeVisible();
    expect(create).toHaveBeenCalledTimes(1);
    expect(created).toEqual([
      expect.objectContaining({
        name: "Send the notes",
        instruction: "From Meeting Nov 14, 09:05, remind me:\n\nSend the notes",
        cadence: {
          kind: "once",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          run_at: new Date("2026-11-16T09:30").toISOString(),
        },
      }),
    ]);
    expect(screen.getByText("Reminder set for Nov 16, 09:30.")).toBeVisible();
  });

  it("says when the meeting has no to-dos", async () => {
    const runtime = createTestTeamHubRuntime();
    renderPage(runtime, "## Action Items\n\nNone observed.\n");
    expect(
      await screen.findByText(
        "This meeting has no to-dos to remind you about.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create reminders" }),
    ).toBeNull();
  });
});
