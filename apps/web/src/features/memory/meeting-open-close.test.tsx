import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingOpenAndClose, meetingOpenAndClose } from "./meeting-open-close";

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
});

describe("meetingOpenAndClose", () => {
  it("needs a middle between the two edges", () => {
    expect(meetingOpenAndClose(43)).toBeUndefined();
    expect(meetingOpenAndClose(Number.NaN)).toBeUndefined();
    expect(meetingOpenAndClose(90)).toEqual({ closeAt: 78, edge: 12 });
  });
});

describe("MeetingOpenAndClose", () => {
  it("stays quiet when the recording has no middle", () => {
    render(<MeetingOpenAndClose duration={30} src="blob:recording" />);
    expect(
      screen.queryByRole("button", { name: "Hear the open and the close" }),
    ).toBeNull();
  });

  it("plays the opening and the close together and leaves them when stopped", () => {
    const onEngage = vi.fn();
    const { container } = render(
      <MeetingOpenAndClose
        duration={90}
        mediaType="audio/mp4"
        onEngage={onEngage}
        src="blob:recording"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hear the open and the close" }),
    );
    const [opening, closing] = container.querySelectorAll("audio");
    expect(onEngage).toHaveBeenCalledOnce();
    expect(opening?.currentTime).toBe(0);
    expect(closing?.currentTime).toBe(78);
    expect(screen.getByRole("status").textContent).toBe(
      "Hearing the open and the close",
    );

    opening!.currentTime = 12;
    fireEvent.timeUpdate(opening!);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Stop the open and the close" }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(closing?.paused).toBe(true);
  });
});
