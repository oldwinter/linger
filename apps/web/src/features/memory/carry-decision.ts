import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { parseMeetingSummary } from "./meeting-overview";

export interface MeetingDecision {
  id: string;
  text: string;
}

export function carryDecisionPath(tenantId: string, entryId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/carry-decision?entry=${encodeURIComponent(entryId)}`;
}

/** Decisions the summary already labeled, in document order. */
export function meetingDecisions(content: string): MeetingDecision[] {
  const markdown = content.replace(/^#[ \t]+[^\n]*\n?/mu, "");
  const decisions: MeetingDecision[] = [];
  for (const block of parseMeetingSummary(markdown)) {
    if (block.kind !== "outcomes") continue;
    for (const outcome of block.outcomes) {
      if (outcome.label !== "Decision") continue;
      const text = [outcome.text, ...outcome.children]
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
      if (!text) continue;
      decisions.push({ id: `decision-${decisions.length}`, text });
    }
  }
  return decisions;
}

export function decisionMessage(meetingLabel: string, text: string) {
  return `From ${meetingLabel}:\n\n${text}`;
}

export function carryRoomTitle(room: TeamHubRoomListItem) {
  return room.direct_peer?.display_name ?? room.name;
}

/** Threads are messages inside a room, not a place that receives a decision. */
export function roomsThatCanReceive(rooms: readonly TeamHubRoomListItem[]) {
  return rooms
    .filter((room) => room.kind !== "thread")
    .slice()
    .sort((left, right) =>
      carryRoomTitle(left).localeCompare(carryRoomTitle(right)),
    );
}
