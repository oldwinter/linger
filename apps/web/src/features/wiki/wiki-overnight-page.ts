import { dayKey } from "@/lib/date-format";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

import type { RecentWikiPage } from "./recent-wiki-pages";
import { wikiPagePath } from "./wiki-display-state";

/**
 * The Wiki page Another Me finished yesterday and that has not been opened
 * since. The latest finish is the one waiting this morning.
 */
export function overnightWikiPage(
  pages: readonly TeamHubDocument[],
  read: readonly Pick<RecentWikiPage, "id" | "openedAt">[],
  now: Date,
): TeamHubDocument | undefined {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);
  const waiting = pages.filter((page) => {
    if (page.creator.kind !== "agent") return false;
    if (!page.from.some((source) => source.binding_kind === "wiki_page")) {
      return false;
    }
    if (/\/index\.md$/i.test(wikiPagePath(page))) return false;
    const updated = new Date(page.updated_at);
    if (Number.isNaN(updated.getTime()) || dayKey(updated) !== yesterdayKey) {
      return false;
    }
    const opened = read.find((entry) => entry.id === page.id);
    return !opened || Date.parse(opened.openedAt) < updated.getTime();
  });
  return waiting.sort(
    (left, right) =>
      right.updated_at.localeCompare(left.updated_at) ||
      right.id.localeCompare(left.id),
  )[0];
}
