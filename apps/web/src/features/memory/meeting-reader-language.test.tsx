import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { LibraryLayout } from "@/features/library/library-layout";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { MeetingPage } from "./meeting-page";

const extras = zhCN.meetingsExtras;
const meetings = zhCN.meetings;

const entry: TeamHubMemoryEntry = {
  id: "meeting_012345678901234567890123",
  kind: "meeting",
  title: "Meeting 14-30-05",
  path: "Meetings/2026/09/23/Meeting 14-30-05",
  content: [
    "---",
    "type: Session",
    "---",
    "",
    "# Launch kickoff",
    "",
    "## Meeting Summary",
    "",
    "### Release plan [00:01:00 - 00:05:00]",
    "",
    "- Open source by October [R1].",
    "",
    "## Action Items",
    "",
    "None observed.",
    "",
  ].join("\n"),
  summary: "",
  updated_at: "2026-09-23T07:00:00Z",
  meeting: {
    capture_id: "capture_meeting",
    started_at: "2026-09-23T06:30:05Z",
    recording_document_id: "audio",
    recording_version_id: "audio_v1",
    recording_filename: "recording.m4a",
    transcript_document_id: "document-meeting-transcript",
    transcript_version_id: "document-meeting-transcript-version-1",
    summary_ready: true,
  },
};

function renderMeeting() {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
    items: query.get("kind") === "meeting" ? [entry] : [],
  }));
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/memory/{entryId}",
    () => entry,
  );
  const router = createMemoryRouter(
    [
      {
        element: <LibraryLayout />,
        children: [
          { element: <MeetingPage />, path: "/t/:tenantId/library/meetings" },
        ],
      },
    ],
    {
      initialEntries: [
        `/t/tenant-northstar/library/meetings?entry=${entry.id}&file=summary`,
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

describe("the meeting reader in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("words its own headings in Chinese and keeps the page's text", async () => {
    await setLanguage("zh-CN");
    renderMeeting();

    const summary = await screen.findByRole("article", {
      name: meetings.meetingSummary,
    });
    const overview = within(summary).getByRole("region", {
      name: meetings.overview,
    });
    expect(
      within(overview).getByRole("heading", {
        level: 2,
        name: extras.meetingSummary,
      }),
    ).toBeVisible();
    // The topic is the page's own text and stays as written.
    expect(overview).toHaveTextContent("Release plan");

    const todo = within(summary).getByRole("region", {
      name: extras.todoList,
    });
    expect(
      within(todo).getByRole("heading", { level: 2, name: extras.todoList }),
    ).toBeVisible();
    expect(todo).toHaveTextContent(extras.noneObserved);
  });
});
