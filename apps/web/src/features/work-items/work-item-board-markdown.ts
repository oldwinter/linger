import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { WORK_ITEM_DASHBOARD_PRIORITY_LABELS } from "./work-item-dashboard-filters";
import { dashboardWorkItemPath } from "./work-item-routes";

export interface WorkItemBoardSection {
  items: readonly TeamHubWorkItem[];
  label: string;
}

/**
 * The board exactly as it is showing: the columns and card order on screen,
 * the filters that narrowed it, and absolute links back to each Item.
 */
export function workItemBoardMarkdown({
  filters,
  origin,
  sections,
  sortLabel,
  tenantId,
}: {
  /** The active filters, already named for a reader, e.g. "Room #GTM launch". */
  filters: readonly string[];
  /** The app origin, so a pasted link opens the board's Item anywhere. */
  origin: string;
  /** The board's columns in display order, each with the cards it shows. */
  sections: readonly WorkItemBoardSection[];
  sortLabel: string;
  tenantId: string;
}) {
  const lines = [
    "# Work Items",
    "",
    [...filters, `Sort ${sortLabel}`].join(" · "),
  ];
  for (const section of sections) {
    if (!section.items.length) continue;
    lines.push("", `## ${section.label}`);
    for (const item of section.items) {
      lines.push(`- ${workItemLine(item, { origin, tenantId })}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function workItemLine(
  item: TeamHubWorkItem,
  { origin, tenantId }: { origin: string; tenantId: string },
) {
  const link = new URL(
    dashboardWorkItemPath(tenantId, item.id),
    origin,
  ).toString();
  const parts = [
    `[${item.title}](${link})`,
    `${WORK_ITEM_DASHBOARD_PRIORITY_LABELS[item.priority]} priority`,
  ];
  const assignees = item.assignees
    .map(({ actor }) => actor.display_name)
    .join(", ");
  if (assignees) parts.push(`Assigned to ${assignees}`);
  return parts.join(" · ");
}
