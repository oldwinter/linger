import { describe, expect, it } from "vitest";

import {
  CONVERSATION_BEAT_MAX_MS,
  CONVERSATION_BEAT_MIN_MS,
  conversationBeatDelay,
  conversationSpeaker,
  conversationWasQuiet,
} from "./conversation-pace";

describe("conversation pace", () => {
  it("holds a short reply for the minimum beat", () => {
    expect(
      conversationBeatDelay(
        "2026-09-21T00:00:00.000Z",
        "2026-09-21T00:00:02.000Z",
      ),
    ).toBe(CONVERSATION_BEAT_MIN_MS);
    expect(
      conversationWasQuiet(
        "2026-09-21T00:00:00.000Z",
        "2026-09-21T00:00:02.000Z",
      ),
    ).toBe(false);
  });

  it("stretches a real pause and then stops stretching", () => {
    const start = "2026-09-21T00:00:00.000Z";
    expect(conversationBeatDelay(start, "2026-09-21T00:01:00.000Z")).toBe(1000);
    expect(conversationBeatDelay(start, "2026-09-21T00:20:00.000Z")).toBe(
      CONVERSATION_BEAT_MAX_MS,
    );
  });

  it("names a gap of a few minutes as quiet", () => {
    expect(
      conversationWasQuiet(
        "2026-09-21T00:00:00.000Z",
        "2026-09-21T00:03:00.000Z",
      ),
    ).toBe(true);
    expect(conversationBeatDelay("later", "earlier")).toBe(
      CONVERSATION_BEAT_MIN_MS,
    );
    expect(
      conversationSpeaker(
        "Blake",
        "2026-09-21T00:00:00.000Z",
        "2026-09-21T00:04:00.000Z",
      ),
    ).toBe("Blake, after a quiet stretch");
    expect(
      conversationSpeaker("Alice", undefined, "2026-09-21T00:00:00.000Z"),
    ).toBe("Alice");
  });
});
