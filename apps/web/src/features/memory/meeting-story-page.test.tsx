import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { MeetingStoryPage } from "./meeting-story-page";

const entryId = "meeting_012345678901234567890123";

function entry(): TeamHubMemoryEntry {
  return {
    id: entryId,
    kind: "meeting",
    title: "Meeting 09-05-00",
    path: "Meetings/2026/11/14/Meeting 09-05-00",
    content: `## Decisions And Outcomes

- Decision: Ship the Friday release.

## Action Items

- Action: Send the notes.
`,
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

describe("MeetingStoryPage", () => {
  it("lifts the line you would actually tell", async () => {
    const runtime = createTestTeamHubRuntime();
    const meeting = entry();
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
      items: query.get("kind") === "meeting" ? [meeting] : [],
    }));
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/memory/{entryId}",
      () => meeting,
    );
    const router = createMemoryRouter(
      [
        {
          element: <MeetingStoryPage />,
          path: "/t/:tenantId/library/meeting-story",
        },
      ],
      {
        initialEntries: [
          `/t/tenant-northstar/library/meeting-story?entry=${entryId}`,
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
    expect(
      await screen.findByText("You decided: Ship the Friday release."),
    ).toBeVisible();
    const tell = screen.getAllByRole("button", {
      name: "This is the part I would tell",
    });
    fireEvent.click(tell[0]!);
    expect(
      screen.getByRole("heading", { name: "The part you would tell" }),
    ).toBeVisible();
    expect(tell[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the chosen line the next time the story opens", async () => {
    localStorage.clear();
    const runtime = createTestTeamHubRuntime();
    const meeting = entry();
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
      items: query.get("kind") === "meeting" ? [meeting] : [],
    }));
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/memory/{entryId}",
      () => meeting,
    );
    function draw() {
      const router = createMemoryRouter(
        [
          {
            element: <MeetingStoryPage />,
            path: "/t/:tenantId/library/meeting-story",
          },
        ],
        {
          initialEntries: [
            `/t/tenant-northstar/library/meeting-story?entry=${entryId}`,
          ],
        },
      );
      return render(
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
    const first = draw();
    const tell = await screen.findAllByRole("button", {
      name: "This is the part I would tell",
    });
    fireEvent.click(tell[0]!);
    expect(
      screen.getByRole("heading", { name: "The part you would tell" }),
    ).toBeVisible();
    first.unmount();
    cleanup();
    draw();
    expect(
      await screen.findByRole("heading", { name: "The part you would tell" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", {
        name: "This is the part I would tell",
      })[0],
    ).toHaveAttribute("aria-pressed", "true");
  });
});
