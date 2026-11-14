import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatPlaybackTime, MeetingAudioPlayer } from "./meeting-audio-player";

afterEach(() => vi.restoreAllMocks());

const rateLabels = ["0.75x", "1x", "1.25x", "1.5x", "2x"];

function renderPlayer(meetingId = "meeting-1") {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  const onDownload = vi.fn();
  const player = (id: string) => (
    <MeetingAudioPlayer
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
