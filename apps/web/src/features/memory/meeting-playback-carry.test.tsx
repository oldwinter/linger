import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearLocalAuthenticatedState } from "@/features/auth/local-authenticated-state";
import {
  createDocumentTestRuntime,
  seedRoomUpload,
} from "@/test/document-scenarios";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { MeetingCarryBar } from "./meeting-carry-bar";
import { carriedMeetingSnapshot, releaseCarriedMeeting } from "./meeting-carry";
import { MeetingReader } from "./meeting-reader";

afterEach(() => {
  cleanup();
  releaseCarriedMeeting();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function renderMeetingPlayback() {
  const runtime = createDocumentTestRuntime();
  const recording = await seedRoomUpload(runtime, "carried-recording", {
    file: new File(["audio"], "recording.m4a", { type: "audio/mp4" }),
    representationFormat: "m4a",
  });
  const transcript = await seedRoomUpload(runtime, "carried-transcript", {
    file: new File(
      ["[00:00] Speaker 1: A recording to keep listening to."],
      "transcript.md",
      {
        type: "text/markdown",
      },
    ),
    representationFormat: "markdown",
  });
  const dispose = vi.fn();
  const reloadedDispose = vi.fn();
  const url = "/v0/document-versions/version-carried-recording/content";
  const getContentLocation = vi
    .spyOn(runtime.client, "getDocumentVersionContentLocation")
    .mockResolvedValueOnce({ dispose, url })
    .mockResolvedValue({ dispose: reloadedDispose, url });
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  const entry: TeamHubMemoryEntry = {
    content: "## Summary\nA recording to keep listening to.",
    id: "meeting_012345678901234567890123",
    kind: "meeting",
    meeting: {
      capture_id: "capture-meeting",
      recording_document_id: recording.id,
      recording_filename: "recording.m4a",
      recording_version_id: "version-carried-recording",
      started_at: "2026-09-23T06:30:05Z",
      summary_ready: true,
      transcript_document_id: transcript.id,
      transcript_version_id: "version-carried-transcript",
    },
    path: "Meetings/2026/09/23/Meeting 14-30-05",
    summary: "",
    title: "Meeting 14-30-05",
    updated_at: "2026-09-23T07:00:00Z",
  };
  const meetingPath = "/t/tenant-northstar/library/meetings?entry=" + entry.id;
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Outlet />
            <MeetingCarryBar />
          </>
        ),
        children: [
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
          {
            element: <h1>Dashboard</h1>,
            path: "/t/:tenantId/dashboard",
          },
        ],
      },
      { element: <h1>Log in</h1>, path: "/login" },
    ],
    { initialEntries: [meetingPath] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", {
    name: "Play recording",
  });
  await waitFor(() => expect(button).toBeEnabled());
  const audio = document.querySelector("audio");
  if (!audio)
    throw new Error("The recording did not render its audio element.");
  Object.defineProperty(audio, "duration", { configurable: true, value: 125 });
  fireEvent.loadedMetadata(audio);
  return {
    audio,
    dispose,
    getContentLocation,
    meetingPath,
    play,
    queryClient,
    reloadedDispose,
    router,
    url,
  };
}

describe("meeting playback carry", () => {
  it.each(["before", "after"])(
    "releases session playback when authentication clears %s route cleanup",
    async (clearWhen) => {
      const { audio, dispose, queryClient, router } =
        await renderMeetingPlayback();
      fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
      fireEvent.play(audio);
      audio.currentTime = 42;
      fireEvent.timeUpdate(audio);

      if (clearWhen === "before") {
        act(() => clearLocalAuthenticatedState(queryClient));
      }
      await act(async () => {
        await router.navigate("/login");
      });
      if (clearWhen === "after") {
        act(() => clearLocalAuthenticatedState(queryClient));
      }

      expect(screen.getByRole("heading", { name: "Log in" })).toBeVisible();
      expect(carriedMeetingSnapshot()).toBeUndefined();
      expect(dispose).toHaveBeenCalledOnce();
      expect(document.querySelector("audio")).toBeNull();

      await act(async () => {
        await router.navigate("/t/tenant-northstar/dashboard");
      });
      expect(
        screen.queryByRole("region", { name: "Meeting still playing" }),
      ).toBeNull();
      expect(document.querySelector("audio")).toBeNull();
      expect(dispose).toHaveBeenCalledOnce();
    },
  );

  it("keeps the streamed recording after route cleanup and releases it when closed", async () => {
    const {
      audio,
      dispose,
      getContentLocation,
      meetingPath,
      play,
      reloadedDispose,
      router,
      url,
    } = await renderMeetingPlayback();
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    fireEvent.play(audio);
    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);

    await act(async () => {
      await router.navigate("/t/tenant-northstar/dashboard");
    });

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const bar = screen.getByRole("region", { name: "Meeting still playing" });
    expect(bar).toBeVisible();
    expect(within(bar).getByRole("link")).toHaveAttribute("href", meetingPath);
    expect(dispose).not.toHaveBeenCalled();
    const carriedAudio = bar.querySelector("audio");
    if (!carriedAudio) throw new Error("The carried recording has no player.");
    expect(carriedAudio).toHaveAttribute("src", url);
    fireEvent.loadedMetadata(carriedAudio);
    expect(carriedAudio.currentTime).toBe(42);
    expect(play).toHaveBeenLastCalledWith();
    expect(play.mock.contexts.at(-1)).toBe(carriedAudio);
    expect(getContentLocation).toHaveBeenCalledOnce();

    await act(async () => {
      await router.navigate(meetingPath);
    });
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(document.querySelector("audio")).toBe(carriedAudio);
    expect(getContentLocation).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();

    fireEvent.click(
      within(bar).getByRole("button", { name: "Leave the recording" }),
    );
    expect(
      screen.queryByRole("region", { name: "Meeting still playing" }),
    ).toBeNull();
    const pagePlayer = await screen.findByRole("button", {
      name: "Play recording",
    });
    await waitFor(() => expect(pagePlayer).toBeEnabled());
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(document.querySelector("audio")).not.toBe(carriedAudio);
    expect(getContentLocation).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(reloadedDispose).not.toHaveBeenCalled();

    await act(async () => {
      await router.navigate("/t/tenant-northstar/dashboard");
    });
    expect(document.querySelector("audio")).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(reloadedDispose).toHaveBeenCalledOnce();
  });

  it.each(["not started", "paused", "ended"])(
    "releases a %s recording when its route leaves",
    async (state) => {
      const { audio, dispose, router } = await renderMeetingPlayback();
      if (state !== "not started") {
        fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
        fireEvent.play(audio);
        audio.currentTime = 42;
        fireEvent.timeUpdate(audio);
        if (state === "paused") {
          vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
            () => undefined,
          );
          Object.defineProperty(audio, "paused", {
            configurable: true,
            value: false,
          });
          fireEvent.click(
            screen.getByRole("button", { name: "Pause recording" }),
          );
          fireEvent.pause(audio);
        } else {
          fireEvent.ended(audio);
        }
      }

      await act(async () => {
        await router.navigate("/t/tenant-northstar/dashboard");
      });

      expect(
        screen.queryByRole("region", { name: "Meeting still playing" }),
      ).toBeNull();
      expect(document.querySelector("audio")).toBeNull();
      expect(dispose).toHaveBeenCalledOnce();
    },
  );
});
