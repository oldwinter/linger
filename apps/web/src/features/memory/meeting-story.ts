import { parseMeetingSummary } from "./meeting-overview";

export interface StoryBeat {
  kind: "decision" | "finished" | "open" | "scene";
  text: string;
}

export function meetingStoryPath(tenantId: string, meetingId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/meeting-story?entry=${encodeURIComponent(meetingId)}`;
}

/** The meeting as lines you could say out loud, in page order. */
export function meetingStoryBeats(markdown: string): StoryBeat[] {
  const beats: StoryBeat[] = [];
  for (const block of parseMeetingSummary(markdown)) {
    if (block.kind === "topics") {
      for (const topic of block.topics) {
        const text = topic.title.trim();
        if (text) beats.push({ kind: "scene", text });
      }
      continue;
    }
    if (block.kind !== "outcomes") continue;
    const open = block.title === "To-do list";
    for (const item of block.outcomes) {
      const text = item.text.trim();
      if (!text) continue;
      beats.push({
        kind: open
          ? "open"
          : item.label === "Completed"
            ? "finished"
            : "decision",
        text,
      });
    }
  }
  return beats;
}

export function storySentence(beat: StoryBeat) {
  if (beat.kind === "scene") return `You talked about ${beat.text}.`;
  if (beat.kind === "finished") return `You finished: ${beat.text}`;
  if (beat.kind === "open") return `Still open: ${beat.text}`;
  return `You decided: ${beat.text}`;
}
