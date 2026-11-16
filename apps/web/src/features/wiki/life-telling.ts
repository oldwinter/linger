import type { TeamHubPersonalProfileTimelineEntry } from "@/features/teamhub/teamhub-types";

export interface LifeChapter {
  period: string;
  sentence: string;
}

export function lifePath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/life`;
}

/**
 * The life Another Me would tell, earliest year first. A period with no year
 * stays after the dated ones, in the order it was written.
 */
export function lifeChapters(
  entries: readonly TeamHubPersonalProfileTimelineEntry[],
): LifeChapter[] {
  return oldestFirst(entries).flatMap((entry) => {
    const sentence = lifeSentence(entry);
    return sentence ? [{ period: entry.period, sentence }] : [];
  });
}

function lifeSentence(entry: TeamHubPersonalProfileTimelineEntry): string {
  const place = entry.place.trim();
  const role = entry.role.trim();
  const where = place ? `, ${place}` : "";
  const head = role
    ? `${role} at ${entry.organization}${where}`
    : `${entry.organization}${where}`;
  const rest =
    entry.description.trim() ||
    entry.details.find((item) => item.trim())?.trim() ||
    "";
  return rest ? `${head}. ${rest}` : head;
}

function oldestFirst(
  entries: readonly TeamHubPersonalProfileTimelineEntry[],
): TeamHubPersonalProfileTimelineEntry[] {
  const start = (period: string) => {
    const match = /(\d{4})/.exec(period);
    if (!match?.[1]) return Number.POSITIVE_INFINITY;
    const endsHere = /^\s*[–-]\s*\d{4}/u.test(period);
    return Number(match[1]) * 10 + (endsHere ? 0 : 1);
  };
  return entries
    .map((entry, index) => ({ entry, index, key: start(entry.period) }))
    .sort((left, right) =>
      left.key === right.key ? left.index - right.index : left.key - right.key,
    )
    .map(({ entry }) => entry);
}
