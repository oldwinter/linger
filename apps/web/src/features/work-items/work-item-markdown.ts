import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { workItemPriorityLabel, workItemStateLabel } from "./work-item-labels";

type WorkItemMarkdownItem = Pick<
  TeamHubWorkItem,
  "assignees" | "description" | "priority" | "resolution" | "state" | "title"
>;

/**
 * One Work Item as Markdown that stands alone away from the app: its title and
 * facts, its description, and the link back. Parts it does not have are left
 * out rather than written as placeholders.
 */
export function workItemMarkdown({
  item,
  link,
}: {
  item: WorkItemMarkdownItem;
  link: string;
}): string {
  const assignees = item.assignees.map(({ actor }) => actor.display_name);
  const facts = [
    workItemStateLabel(item),
    workItemPriorityLabel(item.priority),
    ...(assignees.length ? [`Assigned to ${assignees.join(", ")}`] : []),
  ];
  return [`# ${item.title}`, facts.join(" · "), item.description.trim(), link]
    .filter(Boolean)
    .join("\n\n");
}
