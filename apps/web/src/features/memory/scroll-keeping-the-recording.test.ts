import { describe, expect, it } from "vitest";

import { scrollKeepingTheRecording } from "./scroll-keeping-the-recording";

describe("scrollKeepingTheRecording", () => {
  it("keeps a playing recording where it was when the summary arrives", () => {
    expect(scrollKeepingTheRecording(40, 120, 480, true)).toBe(400);
  });

  it("leaves the page where it is when the recording is not playing", () => {
    expect(scrollKeepingTheRecording(40, 120, 480, false)).toBe(40);
    expect(scrollKeepingTheRecording(40, undefined, 480, true)).toBe(40);
  });
});
