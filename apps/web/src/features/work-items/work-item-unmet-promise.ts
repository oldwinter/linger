import { dayKey } from "@/lib/date-format";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

/**
 * A promise is a Work Item you created and assigned to yourself that is still
 * open after the local day you created it.
 */
export function isUnmetPromise(
  item: TeamHubWorkItem,
  actorId: string | undefined,
  now: Date,
): boolean {
  if (!actorId || item.state !== "open" || item.created_by.id !== actorId) {
    return false;
  }
  if (!item.assignees.some((assignment) => assignment.actor.id === actorId)) {
    return false;
  }
  const created = new Date(item.created_at);
  if (Number.isNaN(created.getTime())) return false;
  return dayKey(created) < dayKey(now);
}

/**
 * Unmet promises lead the Todo column, oldest first. Everything else keeps
 * the order it already had.
 */
export function leadUnmetPromises(
  items: readonly TeamHubWorkItem[],
  actorId: string | undefined,
  now: Date,
): TeamHubWorkItem[] {
  const unmet: TeamHubWorkItem[] = [];
  const rest: TeamHubWorkItem[] = [];
  for (const item of items) {
    if (isUnmetPromise(item, actorId, now)) unmet.push(item);
    else rest.push(item);
  }
  unmet.sort(
    (left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  return [...unmet, ...rest];
}
