// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { VoiceTranscriptItem } from "./voice-control-context";
import {
  readSpeakerNames,
  speakerDisplayName,
  speakerKey,
  voicesInTranscript,
  writeSpeakerNames,
} from "./speaker-names";

function line(
  id: string,
  text: string,
  speakerId: string,
  speakerLabel: string,
): VoiceTranscriptItem {
  return { createdAtMs: 1, id, speakerId, speakerLabel, text };
}

describe("speaker names", () => {
  it("groups a recording by speaker id and keeps a typed name", () => {
    expect(speakerKey({ speakerLabel: "Speaker 2" })).toBe("spk_2");
    expect(speakerKey({ speakerLabel: "Maya" })).toBeUndefined();
    const voices = voicesInTranscript([
      line("a", "The budget is set.", "spk_2", "Speaker 2"),
      line("b", "I can send the note.", "spk_1", "Speaker 1"),
      line("c", "Send it today.", "spk_2", "Speaker 2"),
    ]);
    expect(voices.map((voice) => voice.id)).toEqual(["spk_1", "spk_2"]);
    expect(voices[1]?.lines).toEqual(["The budget is set.", "Send it today."]);

    writeSpeakerNames("capture-1", { spk_2: "  Maya Chen  ", spk_9: "" });
    expect(readSpeakerNames("capture-1")).toEqual({ spk_2: "Maya Chen" });
    expect(
      speakerDisplayName("spk_2", "Speaker 2", readSpeakerNames("capture-1")),
    ).toBe("Maya Chen");
    expect(
      speakerDisplayName("spk_1", "Speaker 1", readSpeakerNames("capture-1")),
    ).toBe("Speaker 1");
    localStorage.clear();
  });
});
