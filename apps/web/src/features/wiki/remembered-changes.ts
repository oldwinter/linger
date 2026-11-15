import type {
  TeamHubPersonalProfileDocument,
  TeamHubPersonalProfileModule,
  TeamHubPersonalProfileRevision,
  TeamHubPersonalProfileTimelineEntry,
} from "@/features/teamhub/teamhub-types";

type ProfilePoint = TeamHubPersonalProfileModule["points"][number];

export interface MemoryChange {
  section: string;
  kind: "added" | "removed" | "changed";
  label: string;
  before?: string;
  after?: string;
}

const modules = [
  ["background", "Background"],
  ["communication_style", "Communication style"],
  ["working_style", "Working style"],
  ["preferences", "Preferences"],
  ["writing_style", "Writing style"],
] as const;

/**
 * History is newest first and includes the current revision. The previous
 * profile is the next revision with a different id.
 */
export function previousRememberedRevision(profile: {
  current?: TeamHubPersonalProfileRevision;
  history: readonly TeamHubPersonalProfileRevision[];
}) {
  const currentId = profile.current?.id;
  return profile.history.find((revision) => revision.id !== currentId);
}

export function rememberedPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/remembered`;
}

/** What changed in the profile Another Me keeps, from an older revision to the current one. */
export function memoryChanges(
  current: TeamHubPersonalProfileDocument,
  previous?: TeamHubPersonalProfileDocument,
): MemoryChange[] {
  const changes: MemoryChange[] = [];
  if (!previous || previous.name !== current.name) {
    changes.push(textChange("Name", "Name", previous?.name, current.name));
  }
  for (const [key, section] of modules) {
    const next = current[key];
    const prior = previous?.[key];
    if ((prior?.overview ?? "") !== next.overview) {
      changes.push(
        textChange(section, "Overview", prior?.overview, next.overview),
      );
    }
    changes.push(...pointChanges(section, prior?.points ?? [], next.points));
    if (key === "background") {
      changes.push(
        ...timelineChanges(
          previous?.background.timeline ?? [],
          current.background.timeline,
        ),
      );
    }
  }
  return changes.filter((change) => change.before || change.after);
}

function textChange(
  section: string,
  label: string,
  before: string | undefined,
  after: string,
): MemoryChange {
  const prior = before?.trim() ?? "";
  const next = after.trim();
  if (!prior) return { section, kind: "added", label, after: next };
  if (!next) return { section, kind: "removed", label, before: prior };
  return { section, kind: "changed", label, before: prior, after: next };
}

function pointChanges(
  section: string,
  before: readonly ProfilePoint[],
  after: readonly ProfilePoint[],
) {
  return keyedChanges(
    section,
    before.map((point) => [point.title, pointText(point)] as const),
    after.map((point) => [point.title, pointText(point)] as const),
  );
}

function timelineChanges(
  before: readonly TeamHubPersonalProfileTimelineEntry[],
  after: readonly TeamHubPersonalProfileTimelineEntry[],
) {
  return keyedChanges(
    "Background",
    before.map((entry) => [timelineKey(entry), timelineText(entry)] as const),
    after.map((entry) => [timelineKey(entry), timelineText(entry)] as const),
  );
}

function keyedChanges(
  section: string,
  before: readonly (readonly [string, string])[],
  after: readonly (readonly [string, string])[],
): MemoryChange[] {
  const prior = new Map(before);
  const next = new Map(after);
  const changes: MemoryChange[] = [];
  for (const [label, text] of after) {
    if (!prior.has(label)) {
      changes.push({ section, kind: "added", label, after: text });
    } else if (prior.get(label) !== text) {
      changes.push({
        section,
        kind: "changed",
        label,
        before: prior.get(label),
        after: text,
      });
    }
  }
  for (const [label, text] of before) {
    if (!next.has(label)) {
      changes.push({ section, kind: "removed", label, before: text });
    }
  }
  return changes;
}

function pointText(point: ProfilePoint) {
  return [point.text.trim(), ...point.items.map((item: string) => item.trim())]
    .filter(Boolean)
    .join("\n");
}

function timelineKey(entry: TeamHubPersonalProfileTimelineEntry) {
  return `${entry.period} · ${entry.organization}`;
}

function timelineText(entry: TeamHubPersonalProfileTimelineEntry) {
  return [entry.role, entry.description, ...entry.details]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}
