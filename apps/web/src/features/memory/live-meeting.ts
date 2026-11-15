import type { VoiceCaptureState } from "@/features/rooms/voice-control/voice-control-context";

const hearing = new Set<VoiceCaptureState["status"]>([
  "finalizing",
  "recording",
  "recovering",
  "starting",
]);

/**
 * The line a recording is on right now. The unfinished words win; otherwise
 * the last finished line. Nothing is happening when the capture is idle,
 * saved, or failed.
 */
export function liveMeetingLine(input: {
  partial?: string;
  status: VoiceCaptureState["status"] | undefined;
  texts: readonly string[];
}): string | undefined {
  if (!input.status || !hearing.has(input.status)) return undefined;
  const partial = input.partial?.trim();
  if (partial) return partial;
  for (let index = input.texts.length - 1; index >= 0; index -= 1) {
    const text = input.texts[index]?.trim();
    if (text) return text;
  }
  return "Listening.";
}
