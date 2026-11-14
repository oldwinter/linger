import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import { dayKey } from "@/lib/date-format";

import type { WorkItemBoardSection } from "./work-item-board-markdown";
import { workItemPriorityLabel } from "./work-item-labels";
import { dashboardWorkItemPath } from "./work-item-routes";

/** The CSV's columns, in the order every row writes them. */
export const WORK_ITEM_BOARD_CSV_HEADER = [
  "Title",
  "Status",
  "Priority",
  "Assignees",
  "Source Room",
  "Updated",
  "URL",
] as const;

/**
 * The board exactly as it is showing, one row per card in column order. The
 * text is RFC 4180 CSV: LF line endings and a trailing newline, so a
 * spreadsheet opens it without asking. Reading the board's own sections keeps
 * the rows on the filters and sort the person chose.
 */
export function workItemBoardCsv({
  origin,
  roomLabel,
  sections,
  tenantId,
}: {
  /** The app origin, so each row's link opens the Item anywhere. */
  origin: string;
  /** The board's source-Room label for an Item. */
  roomLabel: (item: TeamHubWorkItem) => string;
  /** The board's columns in display order, each with the cards it shows. */
  sections: readonly WorkItemBoardSection[];
  tenantId: string;
}) {
  const lines = [WORK_ITEM_BOARD_CSV_HEADER.join(",")];
  for (const section of sections) {
    for (const item of section.items) {
      lines.push(
        [
          item.title,
          section.label,
          workItemPriorityLabel(item.priority),
          item.assignees.map(({ actor }) => actor.display_name).join(", "),
          roomLabel(item),
          item.updated_at,
          new URL(dashboardWorkItemPath(tenantId, item.id), origin).toString(),
        ]
          .map(csvValue)
          .join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The file the board saves: the board's name and the day it was saved. */
export function workItemBoardCsvFilename(day: Date = new Date()) {
  return `work-items-${dayKey(day)}.csv`;
}

/** Quotes a value only when CSV requires it, doubling the quotes inside. */
function csvValue(value: string) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
