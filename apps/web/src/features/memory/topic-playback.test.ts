import { describe, expect, it } from "vitest";

import { topicStartSeconds } from "./topic-playback";

describe("topicStartSeconds", () => {
  it("reads the start of an hour-minute-second range", () => {
    expect(topicStartSeconds("00:00:33 - 00:03:51")).toBe(33);
    expect(topicStartSeconds("00:01:00 – 00:05:00")).toBe(60);
    expect(topicStartSeconds("1:02:05 — 1:10:00")).toBe(3725);
  });

  it("reads a minute-second cue", () => {
    expect(topicStartSeconds("12:34")).toBe(754);
  });

  it("ignores a heading that is not a clock", () => {
    expect(topicStartSeconds("")).toBeNull();
    expect(topicStartSeconds("later")).toBeNull();
    expect(topicStartSeconds("00:61:00 - 00:62:00")).toBeNull();
  });
});
