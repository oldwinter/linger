import type { SpeakerNameMap } from "@/features/rooms/voice-control/speaker-names";

/**
 * Shows the names given to a recording's voices in place of `Speaker N`.
 * Only the turn's own label changes; the same words inside what was said stay.
 * The stored transcript is unchanged.
 */
export function nameTranscriptSpeakers(
  markdown: string,
  names: SpeakerNameMap,
): string {
  if (Object.keys(names).length === 0) return markdown;
  return markdown.replace(
    /(^|\n\n)(\[[^\]]*\]\s*)?(Speaker ([1-9]\d*))(?=\s*:?\s)/gu,
    (
      match,
      lead: string,
      cue: string | undefined,
      _label: string,
      number: string,
    ) => {
      const name = names[`spk_${number}`];
      if (!name) return match;
      return `${lead}${cue ?? ""}${name}`;
    },
  );
}
