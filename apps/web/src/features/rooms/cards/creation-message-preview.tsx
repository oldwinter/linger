import type { TeamHubMessageSegment } from "@/features/teamhub/teamhub-types";
import { useT } from "@/i18n/use-translation";

import { cardsMessages } from "./cards.messages";

const emptyActorDisplayNames: Readonly<Record<string, string>> = {};
const taskOutputRequirementsPrefix = "[Task output requirements v1]";

function structuredSegmentFingerprint(
  segment: Exclude<TeamHubMessageSegment, { type: "text" }>,
) {
  switch (segment.type) {
    case "reference":
      return JSON.stringify([
        segment.type,
        segment.content,
        segment.target_type,
        segment.target,
      ]);
    case "file":
      return JSON.stringify([
        segment.type,
        segment.content,
        segment.document_id,
        segment.document_version_id,
      ]);
    case "html_fragment":
      return JSON.stringify([segment.type, segment.content, segment.html]);
    case "document":
      return JSON.stringify([
        segment.type,
        segment.content,
        segment.document_id,
        segment.presentation,
      ]);
    case "skill":
      return JSON.stringify([
        segment.type,
        segment.content,
        segment.target,
        segment.skill_id,
        segment.manifest_version,
      ]);
    case "artifact_tree":
      return JSON.stringify([
        segment.type,
        segment.publication_group_id,
        segment.root_path,
      ]);
    case "meeting_notes":
      return JSON.stringify([segment.type, segment.capture_id]);
  }
}

export function CreationMessagePreview({
  actorDisplayNames = emptyActorDisplayNames,
  segments,
}: {
  actorDisplayNames?: Readonly<Record<string, string>>;
  segments: readonly TeamHubMessageSegment[];
}) {
  const t = useT();
  const occurrences = new Map<string, number>();
  const structuredSegments = segments.flatMap((segment) => {
    if (segment.type === "text") {
      return [];
    }
    const fingerprint = structuredSegmentFingerprint(segment);
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    return [{ key: `${fingerprint}:${occurrence}`, segment }];
  });
  const visibleContent = segments
    .flatMap((segment) =>
      segment.type === "text" &&
      segment.content.startsWith(taskOutputRequirementsPrefix)
        ? []
        : [segment.content],
    )
    .join("");

  return (
    <div>
      <p className="font-medium text-app-body">
        {t(cardsMessages.initialTaskInput)}
      </p>
      <p className="mt-1 whitespace-pre-wrap border-l-2 border-app-border pl-2.5 [overflow-wrap:anywhere] text-sm leading-5 text-app-body">
        {visibleContent}
      </p>
      {structuredSegments.length ? (
        <ul className="mt-2 space-y-1 border-l-2 border-app-border pl-2.5 text-xs text-muted-foreground">
          {structuredSegments.map(({ key, segment }) => (
            <li
              className="flex min-w-0 flex-wrap items-baseline gap-x-1 [overflow-wrap:anywhere]"
              key={key}
            >
              {segment.type === "reference" ? (
                <span>
                  {t(cardsMessages.referenceTarget, {
                    name:
                      actorDisplayNames[segment.target] ??
                      t(cardsMessages.spaceMember),
                    type: segment.target_type,
                  })}
                </span>
              ) : segment.type === "file" ? (
                <span>
                  {t(cardsMessages.fileSegment, { name: segment.content })}
                </span>
              ) : segment.type === "html_fragment" ? (
                <span>{segment.content}</span>
              ) : segment.type === "meeting_notes" ? (
                <span>{t(cardsMessages.meetingSummary)}</span>
              ) : segment.type === "document" ? (
                <span>
                  {t(cardsMessages.documentSegment, { name: segment.content })}
                </span>
              ) : segment.type === "artifact_tree" ? (
                <span>
                  {t(cardsMessages.artifactDirectory, {
                    path: segment.root_path,
                  })}
                </span>
              ) : (
                <span>
                  {t(cardsMessages.skillSegment, { name: segment.content })}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
