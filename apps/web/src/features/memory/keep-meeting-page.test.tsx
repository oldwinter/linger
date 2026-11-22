import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useParams } from "react-router";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubDocument,
  TeamHubMemoryEntry,
} from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { KeepMeetingPage } from "./keep-meeting-page";

const meeting: TeamHubMemoryEntry = {
  id: "meeting_012345678901234567890123",
  kind: "meeting",
  title: "Meeting 14-30-05",
  path: "Meetings/2026/09/23/Meeting 14-30-05",
  content: "# Meeting\n\nWe decided to ship on Friday.",
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

it("keeps the meeting summary as a library page you can open", async () => {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
    items: [meeting],
  }));
  const upload = vi
    .spyOn(runtime.client, "uploadPersonalWikiDocument")
    .mockResolvedValue({ id: "document-kept" } as TeamHubDocument);
  renderPage(runtime);

  expect(
    await screen.findByText("We decided to ship on Friday."),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Page name"), {
    target: { value: "Friday ship" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep this page" }));

  expect(await screen.findByText("Opened document-kept")).toBeVisible();
  expect(upload).toHaveBeenCalledOnce();
  const [, input, key] = upload.mock.calls[0]!;
  expect(input.representationFormat).toBe("markdown");
  expect(input.file.name).toBe("Friday ship.md");
  expect(await input.file.text()).toContain("We decided to ship on Friday.");
  expect(key).toBe(
    "meeting-page:meeting_012345678901234567890123:2026-09-23T07:00:00Z",
  );
});

it("waits for a summary before keeping a page", async () => {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
    items: [{ ...meeting, content: "", summary: "" }],
  }));
  const upload = vi.spyOn(runtime.client, "uploadPersonalWikiDocument");
  renderPage(runtime);

  expect(
    await screen.findByText(
      "The summary is not written yet, so there is nothing to keep as a page.",
    ),
  ).toBeVisible();
  expect(upload).not.toHaveBeenCalled();
});

it("renders a scrollable error state with Back to meetings and Retry", async () => {
  const runtime = createTestTeamHubRuntime();
  let attempts = 0;
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => {
    attempts += 1;
    if (attempts === 1) {
      return teamHubErrorResponse(500, "MEETINGS_UNAVAILABLE", "Unavailable.");
    }
    return { items: [meeting] };
  });
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
  expect(screen.getByRole("main")).toHaveClass("overflow-y-auto");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("We decided to ship on Friday."),
  ).toBeVisible();
});

function OpenedDocument() {
  const { documentId } = useParams();
  return <p>Opened {documentId}</p>;
}

function renderPage(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const router = createMemoryRouter(
    [
      {
        element: <KeepMeetingPage />,
        path: "/t/:tenantId/library/meetings/keep",
      },
      {
        element: <OpenedDocument />,
        path: "/t/:tenantId/documents/:documentId",
      },
    ],
    {
      initialEntries: [
        `/t/tenant-northstar/library/meetings/keep?entry=${meeting.id}`,
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
