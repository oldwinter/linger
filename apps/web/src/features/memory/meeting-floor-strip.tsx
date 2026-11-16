import { floorSentence, type MeetingFloor } from "./meeting-floor";

const fills = [
  "var(--app-ink)",
  "color-mix(in srgb, var(--app-ink) 55%, transparent)",
  "color-mix(in srgb, var(--app-unread) 70%, var(--app-ink))",
  "color-mix(in srgb, var(--app-ink) 28%, transparent)",
];

/** The meeting as one strip: each voice, and the quiet between them. */
export function MeetingFloorStrip({ floor }: { floor: MeetingFloor }) {
  const sentence = floorSentence(floor);
  const speakers = floor.shares.map((share) => share.speaker);
  return (
    <figure className="mb-4">
      <div
        aria-hidden="true"
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-app-border"
      >
        {floor.segments.map((segment) => {
          const speakerIndex = speakers.indexOf(segment.speaker ?? "");
          return (
            <span
              key={`${segment.kind}-${segment.start}`}
              style={{
                background:
                  segment.kind === "quiet"
                    ? "transparent"
                    : fills[(speakerIndex + fills.length) % fills.length],
                width: `${((segment.end - segment.start) / floor.span) * 100}%`,
              }}
              title={segment.kind === "quiet" ? "Quiet" : segment.speaker}
            />
          );
        })}
      </div>
      <figcaption className="mt-2 text-sm text-app-muted">
        {sentence}
      </figcaption>
    </figure>
  );
}
