import { describe, expect, it } from "vitest";

import { liveMeetingLine } from "./live-meeting";

describe("liveMeetingLine", () => {
  it("prefers the words still arriving", () => {
    expect(
      liveMeetingLine({
        partial: " ship it ",
        status: "recording",
        texts: ["We scoped the release."],
      }),
    ).toBe("ship it");
  });

  it("falls back to the last finished line, then to listening", () => {
    expect(
      liveMeetingLine({
        status: "recording",
        texts: ["First.", "  ", "Second."],
      }),
    ).toBe("Second.");
    expect(liveMeetingLine({ status: "starting", texts: [] })).toBe(
      "Listening.",
    );
  });

  it("is absent once the recording is not being heard", () => {
    expect(
      liveMeetingLine({
        partial: "still here",
        status: "completed",
        texts: ["Done."],
      }),
    ).toBeUndefined();
    expect(
      liveMeetingLine({ status: undefined, texts: ["Done."] }),
    ).toBeUndefined();
  });
});
