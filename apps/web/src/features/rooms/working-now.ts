import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

const previewLimit = 80;

/** What the room list can say about a room that is still working. */
export type WorkingPhase = "on-your-message" | "replying" | "working";

export interface WorkingNowRoom {
  id: string;
  name: string;
  phase: WorkingPhase;
  preview: string;
}

/**
 * Rooms whose agents are working, in list order. A thread's work is counted
 * on its parent, so thread rows stay out. The phase follows the latest
 * message's author: the human's message means the agent is still on it, and
 * an agent message means a reply is underway.
 */
export function workingNowRooms(
  rooms: readonly TeamHubRoomListItem[],
  runningRoomIds: readonly string[],
): WorkingNowRoom[] {
  const running = new Set(runningRoomIds);
  return rooms.flatMap((room) => {
    if (room.kind === "thread" || !running.has(room.id)) return [];
    const message = room.latest_message;
    const preview = message
      ? markdownPlainText(message.raw_message).trim()
      : "";
    return [
      {
        id: room.id,
        name: room.direct_peer?.display_name || room.name,
        phase: phaseFor(message?.author.kind),
        preview:
          preview.length > previewLimit
            ? `${preview.slice(0, previewLimit)}…`
            : preview,
      },
    ];
  });
}

export function workingPhaseLabel(phase: WorkingPhase): string {
  if (phase === "on-your-message") return "On your message";
  if (phase === "replying") return "Replying";
  return "Working";
}

function phaseFor(kind: string | undefined): WorkingPhase {
  if (kind === "human") return "on-your-message";
  if (kind === "agent") return "replying";
  return "working";
}
