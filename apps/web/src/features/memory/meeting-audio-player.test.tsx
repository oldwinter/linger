import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatPlaybackTime, MeetingAudioPlayer } from "./meeting-audio-player";
import {
  carriedMeetingFromLeave,
  carriedMeetingSnapshot,
  carryMeeting,
  releaseCarriedMeeting,
} from "./meeting-carry";
import {
  readMeetingPlaybackSpeed,
  writeMeetingPlaybackSpeed,
} from "./meeting-playback-speed";
import { readMeetingResume, rememberMeetingPosition } from "./meeting-resume";

afterEach(() => {
  releaseCarriedMeeting();
  vi.restoreAllMocks();
});
beforeEach(() => localStorage.clear());

const rateLabels = ["0.75x", "1x", "1.25x", "1.5x", "2x"];

function renderPlayer(meetingId = "meeting-1", accountId?: string) {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  const onDownload = vi.fn();
  const player = (id: string) => (
    <MeetingAudioPlayer
      accountId={accountId}
      filename="recording.m4a"
      mediaType="audio/mp4"
      meetingId={id}
      onDownload={onDownload}
      src="blob:recording"
    />
  );
  const view = render(player(meetingId));
  const audio = view.container.querySelector("audio")!;
  return { ...view, audio, onDownload, play, player };
}

/** Gives the loaded element a duration, as metadata does for a real file. */
function loadDuration(audio: HTMLAudioElement, duration: number) {
  Object.defineProperty(audio, "duration", {
    configurable: true,
    value: duration,
  });
  fireEvent.loadedMetadata(audio);
}

/** Opens the speed list and picks one rate. */
async function chooseRate(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: /Playback speed/ }));
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

const speedTrigger = () =>
  screen.getByRole("combobox", { name: /Playback speed/ });

describe("MeetingAudioPlayer", () => {
  it("formats playback time with hours only when needed", () => {
    expect(
      [0, 9.6, 65, 754.2, 3725, Number.NaN].map(formatPlaybackTime),
    ).toEqual(["0:00", "0:09", "1:05", "12:34", "1:02:05", "0:00"]);
  });

  it("waits disabled while the recording loads", () => {
    render(
      <MeetingAudioPlayer
        downloadDisabled
        filename="recording.m4a"
        onDownload={vi.fn()}
        status="Loading..."
      />,
    );
    expect(
      screen.getByRole("button", { name: "Play recording" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("slider", { name: "Seek recording" }),
    ).toBeDisabled();
    expect(speedTrigger()).toBeDisabled();
    expect(screen.getByText("Loading...")).toBeVisible();
  });

  it("plays, follows the playhead, seeks, and downloads", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const onDownload = vi.fn();
    const { container } = render(
      <MeetingAudioPlayer
        filename="recording.m4a"
        mediaType="audio/mp4"
        onDownload={onDownload}
        src="blob:recording"
      />,
    );
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 125,
    });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText("0:00 / 2:05")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.play(audio);
    expect(
      screen.getByRole("button", { name: "Pause recording" }),
    ).toBeVisible();

    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);
    expect(screen.getByText("0:42 / 2:05")).toBeVisible();

    fireEvent.change(screen.getByRole("slider", { name: "Seek recording" }), {
      target: { value: "100" },
    });
    expect(audio.currentTime).toBe(100);

    fireEvent.click(
      screen.getByRole("button", { name: "Download recording.m4a" }),
    );
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("applies each offered rate to the element", async () => {
    const { audio } = renderPlayer();

    for (const label of rateLabels) {
      await chooseRate(label);

      expect(audio.playbackRate).toBe(Number(label.slice(0, -1)));
      expect(speedTrigger()).toHaveTextContent(label);
    }
  });

  it("marks the chosen rate as selected", async () => {
    renderPlayer();
    await chooseRate("1.5x");

    fireEvent.click(speedTrigger());

    expect(await screen.findByRole("option", { name: "1.5x" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "1x" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("keeps the playhead and playback while changing speed", async () => {
    const { audio, play } = renderPlayer();
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 125,
    });
    fireEvent.loadedMetadata(audio);
    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    fireEvent.play(audio);

    await chooseRate("1.25x");

    expect(audio.playbackRate).toBe(1.25);
    expect(audio.currentTime).toBe(42);
    expect(screen.getByText("0:42 / 2:05")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Pause recording" }),
    ).toBeVisible();
    expect(play).toHaveBeenCalledOnce();
  });

  it("starts the next meeting at 1x", async () => {
    const { audio, player, rerender } = renderPlayer("meeting-1");
    await chooseRate("2x");
    expect(audio.playbackRate).toBe(2);

    rerender(player("meeting-2"));

    // The same media element now carries the next meeting at the default rate.
    expect(document.querySelector("audio")).toBe(audio);
    expect(audio.playbackRate).toBe(1);
    expect(speedTrigger()).toHaveTextContent("1x");
  });

  it("keeps the previous rate and says so when the browser refuses one", async () => {
    const { audio } = renderPlayer();
    await chooseRate("1.25x");
    // A browser that clamps keeps the rate it had instead of the requested one.
    let applied = audio.playbackRate;
    Object.defineProperty(audio, "playbackRate", {
      configurable: true,
      get: () => applied,
      set: (value: number) => {
        applied = Math.min(value, 1.25);
      },
    });

    await chooseRate("2x");

    expect(audio.playbackRate).toBe(1.25);
    expect(speedTrigger()).toHaveTextContent("1.25x");
    expect(screen.getByRole("status")).toHaveTextContent("Speed unavailable");
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("leaves the element at 1x when the player unmounts", async () => {
    const { audio, unmount } = renderPlayer();
    await chooseRate("2x");
    expect(audio.playbackRate).toBe(2);

    unmount();

    expect(audio.playbackRate).toBe(1);
  });
});

describe("MeetingAudioPlayer resume", () => {
  const ACCOUNT = "account-a";

  it("starts paused at the remembered place inside the recording", () => {
    rememberMeetingPosition(ACCOUNT, "meeting-1", 80, 1_000);
    const { audio } = renderPlayer("meeting-1", ACCOUNT);

    loadDuration(audio, 125);

    expect(audio.currentTime).toBe(80);
    expect(screen.getByText(/Resumed at 1:20 \/ 2:05/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Play recording" }),
    ).toBeVisible();
  });

  it("starts at zero near the end of the recording", () => {
    rememberMeetingPosition(ACCOUNT, "meeting-1", 123, 1_000);
    const { audio } = renderPlayer("meeting-1", ACCOUNT);

    loadDuration(audio, 125);

    expect(audio.currentTime).toBe(0);
    expect(screen.queryByText(/Resumed at/)).not.toBeInTheDocument();
  });

  it("keeps another Account's position out of this player", () => {
    rememberMeetingPosition("account-b", "meeting-1", 80, 1_000);
    const { audio } = renderPlayer("meeting-1", ACCOUNT);

    loadDuration(audio, 125);

    expect(audio.currentTime).toBe(0);
    expect(screen.queryByText(/Resumed at/)).not.toBeInTheDocument();
  });

  it("saves the place as soon as playback pauses", () => {
    const { audio } = renderPlayer("meeting-1", ACCOUNT);
    loadDuration(audio, 125);
    audio.currentTime = 42;

    fireEvent.pause(audio);

    expect(readMeetingResume(ACCOUNT)["meeting-1"]?.position).toBe(42);
  });

  it("writes at most once per interval while time updates stream in", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { audio } = renderPlayer("meeting-1", ACCOUNT);
    loadDuration(audio, 125);

    audio.currentTime = 10;
    fireEvent.timeUpdate(audio);
    expect(readMeetingResume(ACCOUNT)["meeting-1"]?.position).toBe(10);

    now.mockReturnValue(1_002_000);
    audio.currentTime = 20;
    fireEvent.timeUpdate(audio);
    expect(readMeetingResume(ACCOUNT)["meeting-1"]?.position).toBe(10);

    now.mockReturnValue(1_006_000);
    audio.currentTime = 30;
    fireEvent.timeUpdate(audio);
    expect(readMeetingResume(ACCOUNT)["meeting-1"]?.position).toBe(30);
  });

  it("starts over from the beginning and forgets the place", () => {
    rememberMeetingPosition(ACCOUNT, "meeting-1", 80, 1_000);
    const { audio } = renderPlayer("meeting-1", ACCOUNT);
    loadDuration(audio, 125);
    expect(audio.currentTime).toBe(80);

    fireEvent.click(
      screen.getByRole("button", { name: "Start from the beginning" }),
    );

    expect(audio.currentTime).toBe(0);
    expect(screen.queryByText(/Resumed at/)).not.toBeInTheDocument();
    expect(readMeetingResume(ACCOUNT)["meeting-1"]).toBeUndefined();
  });

  it("forgets the place when the listener drags back to the start", () => {
    rememberMeetingPosition(ACCOUNT, "meeting-1", 80, 1_000);
    const { audio } = renderPlayer("meeting-1", ACCOUNT);
    loadDuration(audio, 125);

    fireEvent.change(screen.getByRole("slider", { name: "Seek recording" }), {
      target: { value: "0" },
    });

    expect(audio.currentTime).toBe(0);
    expect(readMeetingResume(ACCOUNT)["meeting-1"]).toBeUndefined();
  });

  it("saves the place when the player closes", () => {
    const { audio, unmount } = renderPlayer("meeting-1", ACCOUNT);
    loadDuration(audio, 125);
    audio.currentTime = 55;

    unmount();

    expect(readMeetingResume(ACCOUNT)["meeting-1"]?.position).toBe(55);
  });
});

describe("MeetingAudioPlayer keyboard", () => {
  /** The player inside a meeting surface, as the reader renders it. */
  function renderOnMeetingSurface() {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    const view = render(
      <div data-meeting-surface>
        <MeetingAudioPlayer
          filename="recording.m4a"
          mediaType="audio/mp4"
          meetingId="meeting-1"
          onDownload={vi.fn()}
          src="blob:recording"
        />
        <input aria-label="Search transcript" type="search" />
      </div>,
    );
    const audio = view.container.querySelector("audio")!;
    const surface = view.container.querySelector("[data-meeting-surface]")!;
    // jsdom has no media engine, so the element's pause state is the test's to
    // report.
    let paused = true;
    Object.defineProperty(audio, "paused", {
      configurable: true,
      get: () => paused,
    });
    function setPaused(value: boolean) {
      paused = value;
    }
    return { ...view, audio, pause, play, setPaused, surface };
  }

  it("toggles playback with Space and keeps the page still", () => {
    const { audio, pause, play, setPaused, surface } = renderOnMeetingSurface();

    // A prevented keydown is what stops the page from scrolling.
    expect(fireEvent.keyDown(surface, { key: " " })).toBe(false);
    expect(play).toHaveBeenCalledOnce();

    setPaused(false);
    fireEvent.play(audio);
    expect(
      screen.getByRole("button", { name: "Pause recording" }),
    ).toBeVisible();

    expect(fireEvent.keyDown(surface, { key: " " })).toBe(false);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("moves the playhead five seconds each way and stops at both ends", () => {
    const { audio, surface } = renderOnMeetingSurface();
    loadDuration(audio, 125);
    audio.currentTime = 10;
    fireEvent.timeUpdate(audio);

    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(15);
    expect(screen.getByText("0:15 / 2:05")).toBeVisible();

    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    expect(audio.currentTime).toBe(10);

    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    expect(audio.currentTime).toBe(0);

    audio.currentTime = 124;
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(125);
  });

  it("leaves the transcript search field its own keys", () => {
    const { play, surface } = renderOnMeetingSurface();
    const search = screen.getByRole("searchbox", { name: "Search transcript" });

    for (const key of [" ", "ArrowLeft", "ArrowRight"]) {
      expect(fireEvent.keyDown(search, { key })).toBe(true);
    }
    expect(play).not.toHaveBeenCalled();
    expect(surface.contains(search)).toBe(true);
  });

  it("leaves a focused control its own Space", () => {
    const { play } = renderOnMeetingSurface();
    const button = screen.getByRole("button", { name: "Play recording" });

    expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("leaves keys alone while a dialog is open", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const { container } = render(
      <div data-meeting-surface>
        <MeetingAudioPlayer
          filename="recording.m4a"
          mediaType="audio/mp4"
          meetingId="meeting-1"
          onDownload={vi.fn()}
          src="blob:recording"
        />
        <dialog open>
          <button type="button">Cancel</button>
        </dialog>
      </div>,
    );
    const surface = container.querySelector("[data-meeting-surface]")!;

    expect(fireEvent.keyDown(surface, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "ArrowRight" })).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("leaves modifier chords alone", () => {
    const { play, surface } = renderOnMeetingSurface();

    expect(fireEvent.keyDown(surface, { ctrlKey: true, key: " " })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: " ", shiftKey: true })).toBe(true);
    expect(
      fireEvent.keyDown(surface, { altKey: true, key: "ArrowRight" }),
    ).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("keeps out of keys pressed outside the meeting", () => {
    const { play } = renderOnMeetingSurface();

    expect(fireEvent.keyDown(document.body, { key: " " })).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });
});

describe("MeetingAudioPlayer speed memory", () => {
  const ACCOUNT = "account-a";

  /** Opens the player before its recording, as the reader does while loading. */
  function renderLateRecording(meetingId: string, accountId?: string) {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const player = (src?: string) => (
      <MeetingAudioPlayer
        accountId={accountId}
        filename="recording.m4a"
        mediaType="audio/mp4"
        meetingId={meetingId}
        onDownload={vi.fn()}
        src={src}
      />
    );
    const view = render(player());
    return {
      ...view,
      audio: () => view.container.querySelector("audio"),
      play,
      player,
    };
  }

  it("opens at the Account's stored speed", () => {
    writeMeetingPlaybackSpeed(ACCOUNT, 1.5);

    const { audio } = renderPlayer("meeting-1", ACCOUNT);

    expect(audio.playbackRate).toBe(1.5);
    expect(speedTrigger()).toHaveTextContent("1.5x");
  });

  it("keeps the chosen speed when another meeting opens", async () => {
    const { audio, player, rerender } = renderPlayer("meeting-1", ACCOUNT);
    await chooseRate("2x");
    expect(audio.playbackRate).toBe(2);

    rerender(player("meeting-2"));

    expect(audio.playbackRate).toBe(2);
    expect(speedTrigger()).toHaveTextContent("2x");
  });

  it("keeps the chosen speed for the next player", async () => {
    const first = renderPlayer("meeting-1", ACCOUNT);
    await chooseRate("1.25x");
    first.unmount();
    // The media element itself is left at the default; the Account remembers.
    expect(first.audio.playbackRate).toBe(1);

    const second = renderPlayer("meeting-2", ACCOUNT);

    expect(second.audio.playbackRate).toBe(1.25);
    expect(speedTrigger()).toHaveTextContent("1.25x");
  });

  it("applies the stored speed when the recording arrives after the meeting opens", () => {
    writeMeetingPlaybackSpeed(ACCOUNT, 1.5);
    const { audio, player, rerender } = renderLateRecording(
      "meeting-1",
      ACCOUNT,
    );
    expect(audio()).toBeNull();

    rerender(player("blob:recording"));

    expect(audio()?.playbackRate).toBe(1.5);
    expect(speedTrigger()).toHaveTextContent("1.5x");
  });

  it("keeps 1x when the recording arrives late and nothing is stored", () => {
    const { audio, player, rerender } = renderLateRecording(
      "meeting-1",
      ACCOUNT,
    );

    rerender(player("blob:recording"));

    expect(audio()?.playbackRate).toBe(1);
  });

  it("keeps a chosen speed when the element attaches again", async () => {
    const { audio, player, rerender } = renderLateRecording(
      "meeting-1",
      ACCOUNT,
    );
    rerender(player("blob:recording"));
    await chooseRate("2x");
    expect(audio()?.playbackRate).toBe(2);

    // Losing the recording and getting it back mounts a fresh element.
    rerender(player());
    expect(audio()).toBeNull();
    rerender(player("blob:recording"));

    expect(audio()?.playbackRate).toBe(2);
    expect(speedTrigger()).toHaveTextContent("2x");
  });

  it("keeps another Account's speed out of this player", () => {
    writeMeetingPlaybackSpeed("account-b", 2);

    const { audio } = renderPlayer("meeting-1", ACCOUNT);

    expect(audio.playbackRate).toBe(1);
    expect(speedTrigger()).toHaveTextContent("1x");
  });

  it("keeps the stored speed when the browser refuses a new one", async () => {
    const { audio } = renderPlayer("meeting-1", ACCOUNT);
    await chooseRate("1.25x");
    let applied = audio.playbackRate;
    Object.defineProperty(audio, "playbackRate", {
      configurable: true,
      get: () => applied,
      set: (value: number) => {
        applied = Math.min(value, 1.25);
      },
    });

    await chooseRate("2x");

    expect(readMeetingPlaybackSpeed(ACCOUNT)).toBe(1.25);
  });

  it("reports the playhead when it leaves while the recording is playing", () => {
    const onLeavePlayback = vi.fn();
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const view = render(
      <MeetingAudioPlayer
        filename="recording.m4a"
        mediaType="audio/mp4"
        meetingId="meeting-1"
        onDownload={vi.fn()}
        onLeavePlayback={onLeavePlayback}
        src="blob:recording"
      />,
    );
    const audio = view.container.querySelector("audio")!;
    loadDuration(audio, 125);
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    fireEvent.play(audio);
    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);
    // Taking the element away pauses it. That pause is not the listener stopping.
    fireEvent.pause(audio);
    view.unmount();
    expect(play).toHaveBeenCalled();
    expect(onLeavePlayback).toHaveBeenCalledWith({
      playing: true,
      rate: 1,
      seconds: 42,
    });
  });

  it("stops a recording that followed you when this one starts", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:carried");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    carryMeeting(
      carriedMeetingFromLeave(
        {
          blob: new Blob(["audio"], { type: "audio/mp4" }),
          filename: "other.m4a",
          href: "/meetings?entry=other",
          mediaType: "audio/mp4",
          meetingId: "other",
          title: "Other",
        },
        { playing: true, rate: 1, seconds: 3 },
      )!,
    );
    render(
      <MeetingAudioPlayer
        filename="recording.m4a"
        mediaType="audio/mp4"
        onDownload={vi.fn()}
        src="blob:recording"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(carriedMeetingSnapshot()).toBeUndefined();
  });
});
