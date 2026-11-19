import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMemoryEntry,
  TeamHubVoiceCaptureQuestion,
} from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { AskMeetingPage } from "./ask-meeting-page";

const meeting: TeamHubMemoryEntry = {
  id: "meeting_012345678901234567890123",
  kind: "meeting",
  title: "Meeting 14-30-05",
  path: "Meetings/2026/09/23/Meeting 14-30-05",
  content: "",
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

it("saves an answer from the recording and does not send a task", async () => {
  const runtime = createTestTeamHubRuntime();
  const saved: TeamHubVoiceCaptureQuestion[] = [];
  const posts: unknown[] = [];
  serveMeeting(runtime);
  runtime.server.on(
    "GET",
    "/v0/voice-captures/{captureSessionId}/questions",
    () => ({ items: saved }),
  );
  runtime.server.on(
    "POST",
    "/v0/voice-captures/{captureSessionId}/questions",
    ({ body }) => {
      posts.push(body);
      const question = (body as { question: string }).question;
      const answer: TeamHubVoiceCaptureQuestion = {
        answer: "Ship the note before Friday.",
        answered: true,
        created_at: "2026-09-23T07:10:00Z",
        cutoff_offset_ms: 12000,
        id: "question-1",
        kind: "answer",
        question,
        sources: [
          {
            end_offset_ms: 12000,
            start_offset_ms: 8000,
            text: "Let's ship the note before Friday.",
          },
        ],
      };
      saved.push(answer);
      return answer;
    },
  );
  renderPage(runtime);

  const ask = await screen.findByRole("button", { name: "Ask the recording" });
  expect(ask).toBeDisabled();
  fireEvent.change(screen.getByLabelText("What do you want to know?"), {
    target: { value: "When do we ship the note?" },
  });
  fireEvent.click(ask);

  expect(await screen.findByText("Ship the note before Friday.")).toBeVisible();
  expect(screen.getByText("Let's ship the note before Friday.")).toBeVisible();
  expect(
    runtime.server.requestsTo(
      "POST",
      "/v0/voice-captures/{captureSessionId}/questions/{questionId}/task",
    ),
  ).toHaveLength(0);
  expect(posts).toEqual([{ question: "When do we ship the note?" }]);
});

it("keeps a request for Another Me on the page without sending it", async () => {
  const runtime = createTestTeamHubRuntime();
  const task: TeamHubVoiceCaptureQuestion = {
    answer: "",
    answered: true,
    created_at: "2026-09-23T07:10:00Z",
    cutoff_offset_ms: 4000,
    id: "question-task",
    kind: "task",
    question: "Remind me tomorrow",
    sources: [],
    task_title: "Remind me tomorrow",
  };
  serveMeeting(runtime);
  runtime.server.on(
    "GET",
    "/v0/voice-captures/{captureSessionId}/questions",
    () => ({ items: [task] }),
  );
  renderPage(runtime);

  expect(
    await screen.findByText(
      "This page keeps answers from the recording. That question was a request for Another Me, and it was not sent.",
    ),
  ).toBeVisible();
  expect(
    runtime.server.requestsTo(
      "POST",
      "/v0/voice-captures/{captureSessionId}/questions/{questionId}/task",
    ),
  ).toHaveLength(0);
});

it("shows a retryable alert instead of an empty state when saved questions fail to load", async () => {
  const runtime = createTestTeamHubRuntime();
  serveMeeting(runtime);
  let attempts = 0;
  runtime.server.on(
    "GET",
    "/v0/voice-captures/{captureSessionId}/questions",
    () => {
      attempts += 1;
      if (attempts === 1) {
        return teamHubErrorResponse(
          500,
          "QUESTIONS_UNAVAILABLE",
          "Questions failed.",
        );
      }
      return { items: [] };
    },
  );
  renderPage(runtime);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load saved questions.",
  );
  expect(
    screen.queryByText("Nothing has been asked of this recording yet."),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("Nothing has been asked of this recording yet."),
  ).toBeVisible();
});

it("renders a scrollable container with Back to meetings and Retry when meetings fail to load", async () => {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () =>
    teamHubErrorResponse(500, "MEETINGS_UNAVAILABLE", "Unavailable."),
  );
  renderPage(runtime);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load this meeting.",
  );
  expect(
    screen.getByRole("link", { name: "Back to meetings" }),
  ).toHaveAttribute(
    "href",
    "/t/tenant-northstar/library?tab=meetings&meetings=7d",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(screen.getByRole("main")).toHaveClass("overflow-y-auto");
});

function serveMeeting(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
    items: [meeting],
  }));
}

function renderPage(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const router = createMemoryRouter(
    [
      {
        element: <AskMeetingPage />,
        path: "/t/:tenantId/library/meetings/ask",
      },
    ],
    {
      initialEntries: [
        `/t/tenant-northstar/library/meetings/ask?entry=${meeting.id}`,
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
