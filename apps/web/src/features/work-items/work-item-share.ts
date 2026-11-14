import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { workItemMarkdown } from "./work-item-markdown";

export interface WorkItemShare {
  /** The Item as Markdown, matching the Copy as Markdown action. */
  text: string;
  /** Changes when the Item itself changes. */
  version: string;
}

type ShareableWorkItem = Pick<
  TeamHubWorkItem,
  | "assignees"
  | "description"
  | "id"
  | "priority"
  | "resolution"
  | "state"
  | "title"
  | "version"
>;

/**
 * Reads a Work Item as the Room Message the peek sends: the same Markdown the
 * Copy as Markdown action writes, with the Item's absolute link.
 */
export function workItemShare({
  item,
  url,
}: {
  item: ShareableWorkItem;
  url: string;
}): WorkItemShare {
  return {
    text: workItemMarkdown({ item, link: url }),
    version: sanitized(`${item.id}:${item.version}`),
  };
}

/** One Room Message per Item revision and Room: retrying the same send replays
 * the first Message, while another Room gets its own key. */
export function workItemShareIdempotencyKey(version: string, roomId: string) {
  return sanitized(`work-item-share:${version}:${roomId}`).slice(0, 128);
}

function sanitized(part: string) {
  return part.replace(/[^A-Za-z0-9._:-]/gu, "-");
}
