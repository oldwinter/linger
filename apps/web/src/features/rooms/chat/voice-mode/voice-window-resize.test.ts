// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  containedVoiceWindowPosition,
  resizedVoiceWindowRect,
  useKeptInViewport,
} from "./voice-window-resize";

const min = { height: 100, width: 200 };
const bounds = { bottom: 700, left: 10, right: 1000, top: 20 };
const start = { height: 300, left: 400, top: 200, width: 320 };

describe("resizing a voice window in the page", () => {
  it("moves only the dragged edges", () => {
    expect(resizedVoiceWindowRect(start, "e", 50, 999, min, bounds)).toEqual({
      ...start,
      width: 370,
    });
    expect(resizedVoiceWindowRect(start, "n", 999, -50, min, bounds)).toEqual({
      ...start,
      height: 350,
      top: 150,
    });
    expect(resizedVoiceWindowRect(start, "sw", -40, 60, min, bounds)).toEqual({
      height: 360,
      left: 360,
      top: 200,
      width: 360,
    });
  });

  it("stops at the minimum size and at the bounds", () => {
    expect(resizedVoiceWindowRect(start, "nw", 999, 999, min, bounds)).toEqual({
      height: 100,
      left: 520,
      top: 400,
      width: 200,
    });
    expect(
      resizedVoiceWindowRect(start, "nw", -999, -999, min, bounds),
    ).toEqual({ height: 480, left: 10, top: 20, width: 710 });
    expect(resizedVoiceWindowRect(start, "se", 999, 999, min, bounds)).toEqual({
      height: 500,
      left: 400,
      top: 200,
      width: 600,
    });
  });

  it("never pushes a window that is already too small or outside further", () => {
    // Narrower than the minimum, as in a narrow viewport: it may grow, and
    // shrinking leaves it as it is.
    const narrow = { ...start, width: 150 };
    expect(resizedVoiceWindowRect(narrow, "e", -80, 0, min, bounds)).toEqual(
      narrow,
    );
    // Hanging past the bottom of the page: the bottom edge can come back up
    // but goes no further down.
    const low = { ...start, top: 600 };
    expect(resizedVoiceWindowRect(low, "s", 80, 80, min, bounds)).toEqual(low);
    expect(resizedVoiceWindowRect(low, "s", 0, -80, min, bounds)).toEqual({
      ...low,
      height: 220,
    });
  });
});

describe("moving a voice window in the page", () => {
  const size = { height: 300, width: 320 };

  it("leaves a window that is inside the bounds where it is", () => {
    expect(
      containedVoiceWindowPosition({ left: 400, top: 200 }, size, bounds),
    ).toEqual({ left: 400, top: 200 });
  });

  it("stops the whole window at each side of the bounds", () => {
    expect(
      containedVoiceWindowPosition({ left: -50, top: -50 }, size, bounds),
    ).toEqual({ left: 10, top: 20 });
    expect(
      containedVoiceWindowPosition({ left: 9999, top: 9999 }, size, bounds),
    ).toEqual({ left: 1000 - 320, top: 700 - 300 });
  });

  it("keeps the top left of a window larger than the bounds in view", () => {
    expect(
      containedVoiceWindowPosition(
        { left: 400, top: 200 },
        { height: 900, width: 1200 },
        bounds,
      ),
    ).toEqual({ left: 10, top: 20 });
  });
});

describe("keeping a voice window in the viewport", () => {
  let observed: (() => void)[];
  let size: { height: number; width: number };
  const frame = () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      offsetHeight: { get: () => size.height },
      offsetWidth: { get: () => size.width },
    });
    return { current: element };
  };
  const viewport = () => ({
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    top: 0,
  });
  const shrinkViewport = (width: number, height: number) => {
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("innerHeight", height);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
  };
  const render = (
    start: { left: number; top: number } | undefined,
    options: { enabled?: boolean; width?: number } = {},
  ) => {
    const ref = frame();
    return renderHook(() => {
      const [position, setPosition] = useState(start);
      useKeptInViewport(
        ref,
        position,
        setPosition,
        viewport,
        options.enabled ?? true,
        options.width,
      );
      return position;
    });
  };

  beforeEach(() => {
    observed = [];
    size = { height: 200, width: 200 };
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observed.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  it("moves the window back in when it grows or the viewport shrinks", () => {
    const { result } = render({ left: 700, top: 500 });
    expect(result.current).toEqual({ left: 700, top: 500 });

    size = { height: 400, width: 200 };
    act(() => observed.forEach((callback) => callback()));
    expect(result.current).toEqual({ left: 700, top: 400 });

    shrinkViewport(800, 700);
    expect(result.current).toEqual({ left: 600, top: 300 });
  });

  it("keeps a window easing into a new width in by that width", () => {
    const { result } = render({ left: 700, top: 0 }, { width: 400 });
    expect(result.current).toEqual({ left: 600, top: 0 });
  });

  it("leaves the window alone while disabled, unplaced or gone", () => {
    const disabled = render({ left: 700, top: 500 }, { enabled: false });
    const unplaced = render(undefined);
    const gone = render({ left: 700, top: 500 });
    gone.unmount();
    shrinkViewport(500, 400);
    expect(disabled.result.current).toEqual({ left: 700, top: 500 });
    expect(unplaced.result.current).toBeUndefined();
    expect(observed).toHaveLength(2);
  });
});
