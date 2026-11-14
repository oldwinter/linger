import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import {
  truncateWorkItemTitle,
  WORK_ITEM_TITLE_LIMIT,
  type WorkItemCreateDraft,
} from "./work-item-create-draft";

/** Marks the copy in its title so both Items stay tellable apart on the board. */
const DUPLICATE_TITLE_PREFIX = "Copy of ";

/**
 * The create dialog's initial values for a duplicate: the original's title
 * prefixed, its description verbatim and its priority. Assignees, the origin
 * Room, and lifecycle state belong to the original and are not copied.
 */
export function workItemDuplicateDraft(
  item: TeamHubWorkItem,
): WorkItemCreateDraft {
  return {
    description: item.description,
    originRoomId: "",
    priority: item.priority,
    title: truncateWorkItemTitle(
      `${DUPLICATE_TITLE_PREFIX}${item.title}`,
      WORK_ITEM_TITLE_LIMIT,
    ),
  };
}
