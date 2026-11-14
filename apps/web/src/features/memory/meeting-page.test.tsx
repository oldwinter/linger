import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { LibraryLayout } from "@/features/library/library-layout";
import {
  readRoomComposerDraft,
  writeRoomComposerDraft,
} from "@/features/rooms/room-drafts";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMemoryEntry,
  TeamHubMessage,
  TeamHubMessageCreateInput,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";

import { meetingPath } from "./meeting-routes";
import { MeetingPage } from "./meeting-page";

beforeAll(async () => {
  // Exercise the real preview without timing its cold module transform.
  await import("@/components/read-only-blocknote-document");
});

function meetingEntry(
  overrides: Partial<TeamHubMemoryEntry> = {},
  summaryReady = false,
): TeamHubMemoryEntry {
  return {
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
      summary_ready: summaryReady,
    },
    ...overrides,
  };
}

/** Serves the given meetings from the list and by id. */
function serveMeetings(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  entries: TeamHubMemoryEntry[],
) {
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", ({ query }) => ({
    items: query.get("kind") === "meeting" ? entries : [],
  }));
  serveMemoryEntry(
    runtime,
    ({ params }) => entries.find((entry) => entry.id === params.entryId)!,
  );
}

/** Answers Memory entry reads. */
function serveMemoryEntry<Handler extends TestRouteHandler>(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  handler: Handler,
) {
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory/{entryId}", handler);
  return handler;
}

/** A summary with one trackable Action and two outcomes that are not Actions. */
const actionSummary = [
  "## Decisions And Outcomes",
  "",
  "- Decision: Ship the beta.",
  "- Completed: Cut the release branch.",
  "",
  "## Action Items",
  "",
  "- Action: Send the deck to Dana.",
].join("\n");

/** The seeded Another Me Chat and the Drafts key it owns. */
const anotherMeScope = {
  accountId: "account-jenny",
  roomId: "room-another-me",
  tenantId: "tenant-northstar",
};

/** The composer block a Track click stages for one Action. */
function actionDraft(entry: TeamHubMemoryEntry, action: string) {
  const link = new URL(
    meetingPath("tenant-northstar", entry.id),
    window.location.origin,
  ).toString();
  return `Track this action: ${action}\nFrom the meeting "Meeting · Sep 23, 14:30": ${link}`;
}

/** A summary with two Actions, the second carrying a sub-point. */
const checklistSummary = [
  "## Action Items",
  "",
  "- Action: Send the revised budget to Finance",
  "- Action: Book the follow-up review",
  "  - Confirm the room",
].join("\n");

/** Gives the page a Clipboard API and returns its writeText double. */
function stubClipboard(writeText: (value: string) => Promise<void>) {
  const writeTextDouble = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextDouble },
  });
  return writeTextDouble;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("MeetingPage", () => {
  it("lists every meeting page in the sidebar grouped by day, newest first", async () => {
    // 18:00 local time on 2026-09-23.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 23, 18));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const runtime = await loggedInRuntime();
    const paths = [
      "2026/09/22/Meeting 12-00-00",
      "2026/09/23/Meeting 08-00-00",
      "2026/09/10/Meeting 09-00-00",
      "2026/09/23/Meeting 14-30-05",
      "2026/09/20/Meeting 08-00-00",
    ];
    const items = paths.map((path, index) =>
      meetingEntry({
        id: `meeting_${String(index).padStart(24, "0")}`,
        path: `Meetings/${path}`,
      }),
    );
    const list = vi.fn<TestRouteHandler>(({ query }) =>
      query.get("kind") !== "meeting"
        ? { items: [] }
        : query.get("cursor") === "meetings-next"
          ? { items: items.slice(3) }
          : { items: items.slice(0, 3), next_cursor: "meetings-next" },
    );
    runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", list);
    renderPage(runtime);
    fireEvent.click(screen.getByRole("button", { name: "Expand Meetings" }));
    const meetingsTree = await screen.findByRole("region", {
      name: "Meetings tree",
    });
    // Every meeting on every page, grouped by day with the newest day first.
    await within(meetingsTree).findByRole("region", {
      name: "Meetings on 2026-09-20",
    });
    expect(
      list.mock.calls.map(([request]) => ({
        params: request.params,
        query: Object.fromEntries(request.query),
      })),
    ).toContainEqual({
      params: { tenantId: "tenant-northstar" },
      query: { cursor: "meetings-next", kind: "meeting", limit: "100" },
    });
    expect(
      within(meetingsTree)
        .getAllByRole("region", { name: /^Meetings on / })
        .map((day) => day.getAttribute("aria-label")),
    ).toEqual([
      "Meetings on 2026-09-23",
      "Meetings on 2026-09-22",
      "Meetings on 2026-09-20",
      "Meetings on 2026-09-10",
    ]);
    // Within a day the newest meeting comes first.
    expect(
      within(
        within(meetingsTree).getByRole("region", {
          name: "Meetings on 2026-09-23",
        }),
      )
        .getAllByRole("link", { name: /^Meeting \d{4}-\d{2}-\d{2} / })
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["Meeting 2026-09-23 14:30:05", "Meeting 2026-09-23 08:00:00"]);
    expect(
      within(meetingsTree).queryByRole("link", { name: /^Past 7 days/ }),
    ).toBeNull();
    expect(
      within(meetingsTree).queryByRole("button", {
        name: /(?:Create|Upload|Import)/,
      }),
    ).toBeNull();
    expect(meetingsTree.querySelector('input[type="file"]')).toBeNull();
    // Sorting the presentation must not mutate the query cache's page order.
    expect(items.map((entry) => entry.path)).toEqual(
      paths.map((path) => `Meetings/${path}`),
    );
  });

  it("opens a meeting as one page: tabs on top, the recording closing Summary", async () => {
    // 16:00 local time on 2026-09-23: the meeting is today.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 23, 16));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    const download = vi.spyOn(runtime.client, "downloadDocumentVersion");
    const router = renderPage(runtime);
    const meetingsToggle = screen.getByRole("button", {
      name: "Expand Meetings",
    });
    expect(meetingsToggle.querySelector("svg")).not.toBeNull();
    fireEvent.click(meetingsToggle);
    fireEvent.click(
      await screen.findByRole("link", {
        name: "Meeting 2026-09-23 14:30:05",
      }),
    );
    expect(router.state.location.search).toBe(`?entry=${entry.id}`);
    const reader = await screen.findByRole("article", { name: "Meeting" });
    expect(
      within(reader).getByRole("heading", {
        name: "Meeting · Sep 23, 14:30",
        level: 2,
      }),
    ).toBeVisible();
    // The Transcript tab holds only the transcript; the recording closes Summary.
    expect(
      within(reader).queryByRole("region", { name: "Meeting recording" }),
    ).toBeNull();
    const transcriptTab = within(reader).getByRole("tab", {
      name: "Transcript",
    });
    expect(transcriptTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "document-meeting-transcript-version-1",
        expect.anything(),
      ),
    );
    expect(
      await within(reader).findByRole("article", {
        name: "Read-only Markdown document",
      }),
    ).toHaveAttribute("data-editable", "false");
    expect(
      within(reader).getByRole("button", { name: "Download transcript.md" }),
    ).toBeInTheDocument();

    fireEvent.click(within(reader).getByRole("tab", { name: "Summary" }));
    expect(router.state.location.search).toContain("file=summary");
    expect(
      within(reader).getByText(/The summary is still being written\./),
    ).toBeVisible();
    const summaryPanel = within(reader).getByRole("tabpanel");
    expect(
      within(summaryPanel).getByRole("region", { name: "Meeting recording" }),
    ).toBeInTheDocument();
    expect(
      within(reader)
        .getByRole("tablist", { name: "Meeting views" })
        .compareDocumentPosition(
          within(summaryPanel).getByRole("region", {
            name: "Meeting recording",
          }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Meetings", level: 1 }),
    ).toBeVisible();
    // The meeting reads only; deleting removes it from the reader's Meetings.
    expect(
      within(reader).queryByRole("button", {
        name: /Edit|Rename|Move|Upload/,
      }),
    ).toBeNull();
    expect(
      within(reader).getByRole("button", { name: "Delete" }),
    ).toBeVisible();
  });

  it("adds summary only when ready and never sends it to the Document editor", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry(
      {
        content:
          "---\ntype: session\ngenerated: internal-only\n---\n\n# Decisions\n\nThe meeting summary is ready.\n\n## CRM Evidence Cache\n\nInternal CRM evidence.\n\n### Client Candidates\n\nNone observed.\n\n## Workflow Evidence Cache\n\nInternal workflow evidence.\n\n## Runtime Evidence\n\nNo runtime evidence in bundle.\n\n## Subject Relation Note\n\nInternal authorization note.\n\n## Action Items\n\nConfirm the release.\n\n## Sources\n\nInternal source path.",
      },
      true,
    );
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}&file=summary`);
    expect(
      await screen.findByRole("article", { name: "Meeting summary" }),
    ).toHaveAttribute("data-editable", "false");
    // The route names a meeting, so its collection opens to show it.
    expect(
      screen.getByRole("button", { name: "Collapse Meetings" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("The meeting summary is ready.")).toBeVisible();
    expect(screen.queryByText("CRM Evidence Cache")).toBeNull();
    expect(screen.queryByText("Internal CRM evidence.")).toBeNull();
    expect(screen.queryByText("Client Candidates")).toBeNull();
    expect(screen.queryByText("Workflow Evidence Cache")).toBeNull();
    expect(screen.queryByText("Runtime Evidence")).toBeNull();
    expect(screen.queryByText("Subject Relation Note")).toBeNull();
    expect(screen.queryByText("Internal source path.")).toBeNull();
    expect(screen.queryByText(/internal-only/)).toBeNull();
    // Not a Session page: no overview card.
    expect(
      screen.queryByRole("region", { name: "Meeting overview" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Table of contents" }));
    expect(
      await screen.findByRole("button", { name: "To-do list" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Document mode" })).toBeNull();
  });

  it("shows topic cards inside a Session page summary", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry(
      {
        content:
          "---\ntype: Session\n---\n\n# Launch kickoff\n\n## Objective Summary\n\nScoped the first release [R1]. More detail.\n\n## Meeting Summary\n\n### Release plan [00:01:00 - 00:05:00]\n\n- Open source by October [R1].\n",
      },
      true,
    );
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}&file=summary`);
    const summary = await screen.findByRole("article", {
      name: "Meeting summary",
    });
    const overview = screen.getByRole("region", { name: "Meeting overview" });
    expect(summary).toHaveTextContent("Scoped the first release.");
    expect(overview).not.toHaveTextContent("Scoped the first release.");
    expect(overview).toHaveTextContent(
      "01Release plan00:01:00 – 00:05:00Open source by October.",
    );
    expect(summary.contains(overview)).toBeTruthy();
  });

  it("scrolls summary section links in place, shows missing-section feedback, and leaves private evidence as text", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry(
      {
        content:
          "## Decisions\n\n[Direction](#direction-test)\n\n[Missing section](#missing)\n\n[Raw session](../../evidence/2026-09-09/sessions/room.md)\n\n[Session source](teamhub://documents/doc-one/versions/version-one)\n\n[Website](https://example.test/)\n\n##### Direction: Test\n\nDetails.",
      },
      true,
    );
    serveMeetings(runtime, [entry]);
    const router = renderPage(runtime, `?entry=${entry.id}`);
    const article = await screen.findByRole("article", {
      name: "Meeting summary",
    });
    for (const name of ["Raw session", "Session source"]) {
      expect(within(article).queryByRole("link", { name })).toBeNull();
      expect(within(article).getByText(name)).toBeVisible();
    }
    expect(
      within(article).getByRole("link", { name: "Website" }),
    ).toHaveAttribute("href", "https://example.test/");
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    expect(
      fireEvent.click(within(article).getByRole("link", { name: "Direction" })),
    ).toBe(false);
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(router.state.location.search).toBe(`?entry=${entry.id}`);
    fireEvent.click(
      within(article).getByRole("link", { name: "Missing section" }),
    );
    expect(screen.getByText(/This section is unavailable/)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(article).toBeVisible();
  });

  it("starts all sidebar collections collapsed without an open meeting", async () => {
    const runtime = await loggedInRuntime();
    renderPage(runtime);

    const sidebar = screen.getByRole("complementary", {
      name: "Library sidebar",
    });
    expect(
      within(sidebar).queryByRole("button", { name: "Expand Wiki" }),
    ).toBeNull();
    for (const label of ["Owned by Me", "Shared with me", "Meetings"]) {
      expect(
        within(sidebar).getByRole("button", { name: `Expand ${label}` }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    expect(
      screen.queryByRole("button", { name: "Table of contents" }),
    ).toBeNull();
  });

  it("lists only rendered summary sections and navigates without editing the summary", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry(
      {
        content:
          "---\ntitle: Outline meeting\n---\n#### Summary\n\nMeeting summary.\n\n##### Next step\n\nDo the work.\n\n```markdown\n## Not a section\n```\n\n#### Sources\n\n##### Private references\n\nDo not display.\n",
      },
      true,
    );
    const original = entry.content;
    serveMeetings(runtime, [entry]);
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    renderPage(runtime, `?entry=${entry.id}`);
    const article = await screen.findByRole("article", {
      name: "Meeting summary",
    });
    const button = screen.getByRole("button", { name: "Table of contents" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    const outline = await screen.findByRole("navigation", {
      name: "Document table of contents",
    });
    await waitFor(() =>
      expect(
        within(outline)
          .getAllByRole("button")
          .map((node) => node.textContent),
      ).toEqual(["Summary", "Next step"]),
    );
    expect(
      within(outline).getByRole("button", { name: "Summary" }),
    ).toHaveStyle({ paddingLeft: "8px" });
    const next = within(outline).getByRole("button", { name: "Next step" });
    expect(next).toHaveStyle({ paddingLeft: "20px" });
    fireEvent.click(next);
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(article).toContainElement(
      scroll.mock.instances.at(-1) as HTMLElement,
    );
    expect(article).toHaveAttribute("data-editable", "false");
    expect(entry.content).toBe(original);
    expect(screen.queryByRole("button", { name: "Document mode" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Close table of contents" }),
    );
    expect(
      screen.queryByRole("navigation", { name: "Document table of contents" }),
    ).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("replaces the open outline when changing meetings and handles summaries without headings", async () => {
    const runtime = await loggedInRuntime();
    serveMeetings(runtime, [
      meetingEntry(
        {
          id: "meeting_alpha",
          content: "## Alpha summary\n\nContent.",
        },
        true,
      ),
      meetingEntry(
        {
          id: "meeting_beta",
          path: "Meetings/2026/09/23/Meeting 16-00-00",
          content: "No sections yet.",
        },
        true,
      ),
    ]);
    const router = renderPage(runtime, "?entry=meeting_alpha");
    await screen.findByText("Content.");
    fireEvent.click(screen.getByRole("button", { name: "Table of contents" }));
    const outline = await screen.findByRole("navigation", {
      name: "Document table of contents",
    });
    expect(
      await within(outline).findByRole("button", { name: "Alpha summary" }),
    ).toBeVisible();
    await act(() =>
      router.navigate(
        "/t/tenant-northstar/library/meetings?entry=meeting_beta",
      ),
    );
    await screen.findByText("No sections yet.");
    const emptyOutline = await screen.findByRole("navigation", {
      name: "Document table of contents",
    });
    expect(await within(emptyOutline).findByText("No headings")).toBeVisible();
    expect(within(emptyOutline).queryByText("Alpha summary")).toBeNull();
    await act(() => router.navigate("/t/tenant-northstar/library/meetings"));
    expect(
      screen.queryByRole("button", { name: "Table of contents" }),
    ).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Document table of contents" }),
    ).toBeNull();
  });

  it("stages an Action as an unsent Another Me draft and opens its Chat", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: actionSummary }, true);
    serveMeetings(runtime, [entry]);
    const router = renderPage(runtime, `?entry=${entry.id}&file=summary`);
    const track = await screen.findByRole("button", {
      name: "Track action: Send the deck to Dana.",
    });
    // Only Action items are trackable; the drawn-out decision stays plain.
    expect(
      screen.queryByRole("button", { name: "Track action: Ship the beta." }),
    ).toBeNull();
    fireEvent.click(track);
    expect(readRoomComposerDraft(anotherMeScope).body).toBe(
      actionDraft(entry, "Send the deck to Dana."),
    );
    expect(await screen.findByText("Another Me chat")).toBeVisible();
    expect(router.state.location.state).toEqual({ focusComposer: true });
    expect(router.state.location.pathname).toBe(
      "/t/tenant-northstar/rooms/room-another-me/chat",
    );
  });

  it("keeps an existing Another Me draft and appends the action to it", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: actionSummary }, true);
    serveMeetings(runtime, [entry]);
    writeRoomComposerDraft(anotherMeScope, {
      body: "Ask about the venue.",
      documentContexts: [],
      documentReferences: [],
      mentions: [],
      skillReferences: [],
    });
    renderPage(runtime, `?entry=${entry.id}&file=summary`);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Track action: Send the deck to Dana.",
      }),
    );
    expect(readRoomComposerDraft(anotherMeScope).body).toBe(
      `Ask about the venue.\n\n${actionDraft(entry, "Send the deck to Dana.")}`,
    );
  });

  it("hides Track when the Another Me has no actor", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: actionSummary }, true);
    serveMeetings(runtime, [entry]);
    const anotherMe = vi.fn<TestRouteHandler>(() => ({
      room_id: "room-another-me",
    }));
    runtime.server.on("GET", "/v0/tenants/{tenantId}/another-me", anotherMe);
    renderPage(runtime, `?entry=${entry.id}&file=summary`);
    await waitFor(() => expect(anotherMe).toHaveBeenCalled());
    await act(async () => {});
    expect(
      screen.queryByRole("button", { name: /^Track action:/u }),
    ).toBeNull();
  });

  it("copies the meeting's Actions as a Markdown checklist", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: checklistSummary }, true);
    serveMeetings(runtime, [entry]);
    const writeText = stubClipboard(() => Promise.resolve());
    renderPage(runtime, `?entry=${entry.id}&file=summary`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy actions" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "- [ ] Send the revised budget to Finance",
          "- [ ] Book the follow-up review",
          "  - [ ] Confirm the room",
        ].join("\n"),
      ),
    );
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("says when copying the actions fails instead of claiming success", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: checklistSummary }, true);
    serveMeetings(runtime, [entry]);
    stubClipboard(() => Promise.reject(new Error("Not allowed")));
    renderPage(runtime, `?entry=${entry.id}&file=summary`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy actions" }),
    );

    expect(
      await screen.findByText(
        "Copy failed. Select the actions and copy them yourself.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("copies the meeting's link with the app's origin", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    const writeText = stubClipboard(() => Promise.resolve());
    renderPage(runtime, `?entry=${entry.id}`);

    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        new URL(
          meetingPath("tenant-northstar", entry.id),
          window.location.origin,
        ).toString(),
      ),
    );
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("says when copying the link fails instead of claiming success", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    stubClipboard(() => Promise.reject(new Error("Not allowed")));
    renderPage(runtime, `?entry=${entry.id}`);

    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Copy failed")).toBeVisible();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("copies the transcript as one plain-text line per turn", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    const writeText = stubClipboard(() => Promise.resolve());
    renderPage(runtime, `?entry=${entry.id}&file=transcript`);

    const copy = await screen.findByRole("button", { name: "Copy transcript" });
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.click(copy);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "Sure, sure, then you you you just follow this, this format here and that works. Fine, fine, so I. And then look, this part needs some breathing room, you know? Bao said.",
          "Look, it blinks, but it does not tell you it is recording. And what you have now is not the same thing either.",
          "Right, so, I feel like, because our earlier one, version A looked like this, you know? Ours really looks like this, but this may need a change.",
          "Like we should build it ourselves. Okay okay, you you send me a screenshot, I am online.",
          "Sure, I will send it to you, send it over.",
          "What can you do?",
          "Just leave it running locally. Mm.",
          "Mm",
          "Mm",
        ].join("\n"),
      ),
    );
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("offers Copy transcript only once the transcript text has loaded", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    let releaseContent = () => {};
    const contentHeld = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });
    const version = runtime.seed.documentVersions.get(
      entry.meeting!.transcript_version_id,
    )!;
    const content = runtime.seed.documentVersionContents.get(
      entry.meeting!.transcript_version_id,
    )!;
    runtime.server.on(
      "GET",
      "/v0/document-versions/{documentVersionId}/content",
      async () => {
        await contentHeld;
        return new Response(await content.arrayBuffer(), {
          headers: {
            "content-type": version.media_type,
            "x-content-sha256": version.sha256,
          },
        });
      },
    );
    renderPage(runtime, `?entry=${entry.id}&file=transcript`);

    const copy = await screen.findByRole("button", { name: "Copy transcript" });
    expect(copy).toBeDisabled();

    releaseContent();

    await waitFor(() => expect(copy).toBeEnabled());
  });

  it("says when copying the transcript fails instead of claiming success", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    stubClipboard(() => Promise.reject(new Error("Not allowed")));
    renderPage(runtime, `?entry=${entry.id}&file=transcript`);

    const copy = await screen.findByRole("button", { name: "Copy transcript" });
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.click(copy);

    expect(await screen.findByText("Copy failed")).toBeVisible();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("shows the search match count and the honest no-match state", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}&file=transcript`);

    const reader = await screen.findByRole("article", { name: "Meeting" });
    const search = within(reader).getByRole("searchbox", {
      name: "Search transcript",
    });
    await waitFor(() => expect(search).toBeEnabled());

    fireEvent.change(search, { target: { value: "like" } });
    expect(within(reader).getByRole("status")).toHaveTextContent("2 matches");
    expect(within(reader).getByText("1 of 2")).toBeVisible();

    fireEvent.change(search, { target: { value: "BLINKS" } });
    expect(within(reader).getByRole("status")).toHaveTextContent("1 match");

    fireEvent.change(search, {
      target: { value: "blinks screenshot" },
    });
    expect(within(reader).getByRole("status")).toHaveTextContent("No matches");
    expect(
      within(reader).getByRole("button", { name: "Next match" }),
    ).toBeDisabled();
    expect(
      within(reader).getByRole("button", { name: "Previous match" }),
    ).toBeDisabled();
  });

  it("moves between matches with Previous and Next, wrapping at both ends", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}&file=transcript`);

    const reader = await screen.findByRole("article", { name: "Meeting" });
    const search = within(reader).getByRole("searchbox", {
      name: "Search transcript",
    });
    await waitFor(() => expect(search).toBeEnabled());
    fireEvent.change(search, { target: { value: "like" } });

    const next = within(reader).getByRole("button", { name: "Next match" });
    const previous = within(reader).getByRole("button", {
      name: "Previous match",
    });
    expect(within(reader).getByText("1 of 2")).toBeVisible();
    fireEvent.click(next);
    expect(within(reader).getByText("2 of 2")).toBeVisible();
    fireEvent.click(next);
    expect(within(reader).getByText("1 of 2")).toBeVisible();
    fireEvent.click(previous);
    expect(within(reader).getByText("2 of 2")).toBeVisible();
  });

  it("paints the marks inside the rendered transcript turns", async () => {
    const registry = new Map<string, unknown>();
    const scope = globalThis as {
      CSS?: unknown;
      Highlight?: unknown;
    };
    const previousCss = scope.CSS;
    const previousHighlight = scope.Highlight;
    scope.CSS = { highlights: registry };
    scope.Highlight = FakeHighlight;
    onTestFinished(() => {
      scope.CSS = previousCss;
      scope.Highlight = previousHighlight;
    });
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}&file=transcript`);

    const reader = await screen.findByRole("article", { name: "Meeting" });
    const search = within(reader).getByRole("searchbox", {
      name: "Search transcript",
    });
    await waitFor(() => expect(search).toBeEnabled());
    fireEvent.change(search, { target: { value: "recording" } });

    await waitFor(() =>
      expect(
        (
          registry.get("meeting-transcript-current") as FakeHighlight
        ).ranges.map((range) => range.toString()),
      ).toEqual(["recording"]),
    );
  });

  it("clears the search without touching the transcript or the tab", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    const writeText = stubClipboard(() => Promise.resolve());
    renderPage(runtime, `?entry=${entry.id}&file=transcript`);

    const reader = await screen.findByRole("article", { name: "Meeting" });
    const transcript = await within(reader).findByRole("article", {
      name: "Read-only Markdown document",
    });
    const transcriptText = transcript.textContent;
    const search = within(reader).getByRole("searchbox", {
      name: "Search transcript",
    });
    await waitFor(() => expect(search).toBeEnabled());
    fireEvent.change(search, { target: { value: "like" } });
    expect(within(reader).getByRole("status")).toHaveTextContent("2 matches");

    fireEvent.click(
      within(reader).getByRole("button", { name: "Clear transcript search" }),
    );

    expect(search).toHaveValue("");
    expect(within(reader).queryByRole("status")).toBeNull();
    expect(
      within(reader).getByRole("tab", { name: "Transcript" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(reader).getByRole("article", {
        name: "Read-only Markdown document",
      }).textContent,
    ).toBe(transcriptText);

    fireEvent.click(
      within(reader).getByRole("button", { name: "Copy transcript" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("Look, it blinks, but it does not tell you"),
      ),
    );
  });

  it("copies the summary's Markdown as the reader derived it", async () => {
    const runtime = await loggedInRuntime();
    const summary = [
      "## Decisions And Outcomes",
      "",
      "- Decision: Ship the beta.",
      "- Completed: Cut the release branch.",
      "",
      "## Action Items",
      "",
      "- Action: Send the deck to Dana.",
    ].join("\n");
    const entry = meetingEntry({ content: summary }, true);
    serveMeetings(runtime, [entry]);
    const writeText = stubClipboard(() => Promise.resolve());
    renderPage(runtime, `?entry=${entry.id}&file=summary`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy summary" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(summary));
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("offers Copy summary only when the summary has content", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: "" }, true);
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}&file=summary`);

    expect(
      await screen.findByRole("button", { name: "Download summary" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy summary" })).toBeNull();
  });

  it("says when copying the summary fails instead of claiming success", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: actionSummary }, true);
    serveMeetings(runtime, [entry]);
    stubClipboard(() => Promise.reject(new Error("Not allowed")));
    renderPage(runtime, `?entry=${entry.id}&file=summary`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy summary" }),
    );

    expect(await screen.findByText("Copy failed")).toBeVisible();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("offers Copy actions only when the meeting has Actions", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry(
      {
        content:
          "## Decisions And Outcomes\n\n- Decision: Ship the beta.\n- Completed: Cut the release branch.",
      },
      true,
    );
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}&file=summary`);

    expect(
      await screen.findByRole("region", { name: "Decisions And Outcomes" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy actions" })).toBeNull();
  });

  it("shows a retryable meeting failure", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry();
    serveMeetings(runtime, [entry]);
    const get = serveMemoryEntry(runtime, vi.fn<TestRouteHandler>())
      .mockResolvedValueOnce(
        teamHubErrorResponse(
          500,
          "MEMORY_ENTRY_UNAVAILABLE",
          "Meeting entry unavailable.",
        ),
      )
      .mockResolvedValueOnce(entry);
    renderPage(runtime, `?entry=${entry.id}`);

    expect(
      await screen.findByRole("alert", { name: "Meeting entry unavailable." }),
    ).toBeVisible();
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { entryId: entry.id, tenantId: "tenant-northstar" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry meeting" }));
    expect(
      await screen.findByRole("article", { name: "Meeting" }),
    ).toBeVisible();
  });

  it("lists Rooms and sends the meeting's summary to the chosen Room", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: sharedSummary }, true);
    serveMeetings(runtime, [entry]);
    mockRoomList(runtime);
    const posts = capturePosts(runtime);
    renderPage(runtime, `?entry=${entry.id}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Send to Room" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.raw_message).toBe(sharedMessage(entry));
    expect(posts[0]!.idempotencyKey).toBe(
      `meeting-share:${entry.id}:${entry.updated_at}:room-product-v0`,
    );
  });

  it("keeps the picker open on a refusal and reuses the key when retried", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: sharedSummary }, true);
    serveMeetings(runtime, [entry]);
    mockRoomList(runtime);
    const keys: (string | null)[] = [];
    runtime.server.on(
      "POST",
      "/v0/rooms/{roomId}/messages",
      ({ params, request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return keys.length === 1
          ? teamHubErrorResponse(
              403,
              "FORBIDDEN",
              "You are not allowed to post in this Room.",
            )
          : Response.json(sentMessage(params.roomId!, keys.length), {
              status: 201,
            });
      },
    );
    renderPage(runtime, `?entry=${entry.id}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Send to Room" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    );

    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("gives each Room its own idempotency key", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: sharedSummary }, true);
    serveMeetings(runtime, [entry]);
    mockRoomList(runtime);
    const keys: (string | null)[] = [];
    runtime.server.on(
      "POST",
      "/v0/rooms/{roomId}/messages",
      ({ params, request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return keys.length === 1
          ? teamHubErrorResponse(
              403,
              "FORBIDDEN",
              "You are not allowed to post in this Room.",
            )
          : Response.json(sentMessage(params.roomId!, keys.length), {
              status: 201,
            });
      },
    );
    renderPage(runtime, `?entry=${entry.id}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Send to Room" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "all" }));
    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(
      `meeting-share:${entry.id}:${entry.updated_at}:room-product-v0`,
    );
  });

  it("offers Send to Room only once the summary is ready", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: sharedSummary });
    serveMeetings(runtime, [entry]);
    renderPage(runtime, `?entry=${entry.id}`);

    expect(
      await screen.findByRole("article", { name: "Meeting" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send to Room" })).toBeNull();
  });

  it("disables the Rooms while the summary is being sent", async () => {
    const runtime = await loggedInRuntime();
    const entry = meetingEntry({ content: sharedSummary }, true);
    serveMeetings(runtime, [entry]);
    mockRoomList(runtime);
    let answer: ((response: Response) => void) | undefined;
    runtime.server.on(
      "POST",
      "/v0/rooms/{roomId}/messages",
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    renderPage(runtime, `?entry=${entry.id}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Send to Room" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    );

    await vi.waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "product-v0" }),
      ).toBeDisabled(),
    );
    act(() =>
      answer!(
        Response.json(sentMessage("room-product-v0", 1), { status: 201 }),
      ),
    );
    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
  });
});

/** The summary the reader shows for the seeded meeting, with its own title. */
const sharedSummary = [
  "# Meeting 14-30-05",
  "",
  "## Decisions And Outcomes",
  "",
  "- Decision: Ship the beta.",
].join("\n");

/** The Message sent for the seeded meeting: title, summary, then its link. */
function sharedMessage(entry: TeamHubMemoryEntry) {
  return [
    "# Meeting · Sep 23, 14:30",
    "## Decisions And Outcomes\n\n- Decision: Ship the beta.",
    new URL(
      meetingPath("tenant-northstar", entry.id),
      window.location.origin,
    ).toString(),
  ].join("\n\n");
}

function capturePosts(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const posts: {
    body: TeamHubMessageCreateInput;
    idempotencyKey: string | null;
  }[] = [];
  runtime.server.on(
    "POST",
    "/v0/rooms/{roomId}/messages",
    ({ body, params, request }) => {
      posts.push({
        body: body as TeamHubMessageCreateInput,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      });
      return Response.json(sentMessage(params.roomId!, posts.length), {
        status: 201,
      });
    },
  );
  return posts;
}

function mockRoomList(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const handler = vi.fn(() => ({
    items: [room("room-all", "all"), room("room-product-v0", "product-v0")],
    page: { has_more: false },
  }));
  runtime.server.on("GET", "/v0/tenants/{tenantId}/rooms", handler);
  return handler;
}

function room(id: string, name: string): TeamHubRoomListItem {
  return {
    created_at: "2026-07-23T08:00:00Z",
    created_by: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    description: "",
    id,
    kind: "room",
    latest_room_seq: 0,
    name,
    read_through_room_seq: 0,
    tenant_id: "tenant-northstar",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-07-23T08:00:00Z",
  };
}

function sentMessage(roomId: string, index: number): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    created_at: "2026-09-23T07:00:00Z",
    id: `message-meeting-${index}`,
    message_kind: "conversation",
    raw_message: "",
    room_id: roomId,
    segments: [],
    tenant_id: "tenant-northstar",
  };
}

async function loggedInRuntime() {
  const runtime = createTestTeamHubRuntime();

  return runtime;
}

function renderPage(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  search = "",
) {
  const router = createMemoryRouter(
    [
      {
        element: <LibraryLayout />,
        children: [
          {
            element: <MeetingPage />,
            path: "/t/:tenantId/library/meetings",
          },
        ],
      },
      {
        element: <p>Another Me chat</p>,
        path: "/t/:tenantId/rooms/:roomId/chat",
      },
    ],
    {
      initialEntries: [`/t/tenant-northstar/library/meetings${search}`],
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

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
