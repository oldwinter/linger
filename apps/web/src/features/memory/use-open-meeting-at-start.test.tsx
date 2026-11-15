import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { useOpenMeetingAtStart } from "./use-open-meeting-at-start";

function meeting(id: string): TeamHubMemoryEntry {
  return {
    id,
    kind: "meeting",
    title: id,
    path: "Meetings/2026/11/16/Meeting 09-30-00",
    content: "",
    summary: "",
    updated_at: "2026-11-16T00:00:00Z",
    meeting: {
      capture_id: "capture-1",
      started_at: "2026-11-16T01:30:00Z",
      recording_document_id: "audio",
      recording_version_id: "audio-v1",
      recording_filename: "recording.m4a",
      transcript_document_id: "transcript",
      transcript_version_id: "transcript-v1",
      summary_ready: false,
    },
  };
}

function Harness({ withDraft = false }: { withDraft?: boolean }) {
  useOpenMeetingAtStart("tenant-northstar");
  return withDraft ? <textarea aria-label="Draft" /> : null;
}

function renderAt(withDraft = false) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
    items: [meeting("meeting-1")],
  }));
  const router = createMemoryRouter(
    [
      {
        element: <Harness withDraft={withDraft} />,
        path: "/t/:tenantId/*",
      },
    ],
    {
      initialEntries: ["/t/tenant-northstar/rooms/room-1/chat"],
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
  return router;
}

describe("useOpenMeetingAtStart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the meeting when its start time arrives", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
    vi.setSystemTime(new Date(2026, 10, 16, 9, 29, 55));
    const router = renderAt();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/library/meetings",
    );
    expect(router.state.location.search).toBe("?entry=meeting-1");
  });

  it("stays on the page when the person is writing", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
    vi.setSystemTime(new Date(2026, 10, 16, 9, 29, 55));
    const router = renderAt(true);
    await vi.advanceTimersByTimeAsync(1_000);
    screen.getByRole("textbox", { name: "Draft" }).focus();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-1/chat",
    );
  });
});
