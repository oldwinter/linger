import { Button } from "@/components/ui/button";

import type { SpeakerPartLine } from "./meeting-transcript-text";

/** The transcript as one speaker's words, or the whole meeting. */
export function MeetingSpeakerPart({
  lines,
  onSelect,
  speaker,
  speakers,
}: {
  lines: readonly SpeakerPartLine[];
  onSelect: (speaker: string | undefined) => void;
  speaker?: string;
  speakers: readonly string[];
}) {
  if (speakers.length < 2) return null;
  return (
    <div className="mb-4 flex flex-col gap-4">
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Whose part"
      >
        <Button
          aria-pressed={speaker === undefined}
          onClick={() => onSelect(undefined)}
          size="compact"
          tone={speaker === undefined ? "secondary" : "ghost"}
        >
          Everyone
        </Button>
        {speakers.map((name) => (
          <Button
            aria-pressed={speaker === name}
            key={name}
            onClick={() => onSelect(name)}
            size="compact"
            tone={speaker === name ? "secondary" : "ghost"}
          >
            {name}
          </Button>
        ))}
      </div>
      {speaker ? (
        <article
          aria-label={`${speaker}'s part`}
          className="flex flex-col gap-3"
        >
          {lines.map((line, index) => (
            <p
              className={
                line.kind === "passed"
                  ? "text-sm text-app-muted"
                  : "text-sm text-foreground"
              }
              key={`${line.kind}-${index}`}
            >
              {line.text}
            </p>
          ))}
        </article>
      ) : null}
    </div>
  );
}
