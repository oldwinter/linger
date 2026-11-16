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
    return [
      {
        id: room.id,
        name: room.direct_peer?.display_name || room.name,
        phase: phaseFor(message?.author.kind),
        preview: message ? messagePreview(message.raw_message) : "",
      },
    ];
  });
}

/** A run whose latest message, while it was running, was yours. */
export interface RunYouStarted {
  messageId: string;
  roomId: string;
}

/** The reply from a run you started, kept after you left that room. */
export interface FinishedRun {
  messageId: string;
  name: string;
  reply: string;
  roomId: string;
}

/**
 * Remembers a run you started and, once it finishes while you are in another
 * room, keeps the agent's reply. Being in that room, a failed run, and
 * Another Me's own room leave it out.
 */
export function trackRunsYouStarted({
  activeRoomId,
  actorId,
  anotherMeRoomId,
  failedRoomIds,
  finished,
  rooms,
  runningRoomIds,
  started,
}: {
  activeRoomId?: string;
  actorId?: string;
  anotherMeRoomId?: string;
  failedRoomIds: readonly string[];
  finished: readonly FinishedRun[];
  rooms: readonly TeamHubRoomListItem[];
  runningRoomIds: readonly string[];
  started: readonly RunYouStarted[];
}): { finished: FinishedRun[]; started: RunYouStarted[] } {
  const running = new Set(runningRoomIds);
  const failed = new Set(failedRoomIds);
  const byId = new Map(
    rooms.flatMap((room) =>
      room.kind === "thread" ? [] : [[room.id, room] as const],
    ),
  );
  const nextStarted: RunYouStarted[] = [];
  const seen = new Set<string>();
  for (const prior of started) {
    if (
      prior.roomId === activeRoomId ||
      prior.roomId === anotherMeRoomId ||
      failed.has(prior.roomId)
    ) {
      continue;
    }
    const room = byId.get(prior.roomId);
    if (!room) continue;
    const latest = room.latest_message;
    if (running.has(prior.roomId) || !latest || latest.id === prior.messageId) {
      nextStarted.push(prior);
      seen.add(prior.roomId);
    }
  }
  if (actorId) {
    for (const room of rooms) {
      if (
        room.kind === "thread" ||
        seen.has(room.id) ||
        !running.has(room.id) ||
        room.id === activeRoomId ||
        room.id === anotherMeRoomId
      ) {
        continue;
      }
      const latest = room.latest_message;
      if (!latest || latest.author.id !== actorId) continue;
      nextStarted.push({ messageId: latest.id, roomId: room.id });
      seen.add(room.id);
    }
  }
  const nextFinished: FinishedRun[] = [];
  const finishedIds = new Set<string>();
  for (const prior of finished) {
    if (
      prior.roomId === activeRoomId ||
      running.has(prior.roomId) ||
      failed.has(prior.roomId)
    ) {
      continue;
    }
    nextFinished.push(prior);
    finishedIds.add(prior.roomId);
  }
  for (const prior of started) {
    if (
      finishedIds.has(prior.roomId) ||
      prior.roomId === activeRoomId ||
      prior.roomId === anotherMeRoomId ||
      running.has(prior.roomId) ||
      failed.has(prior.roomId)
    ) {
      continue;
    }
    const room = byId.get(prior.roomId);
    const latest = room?.latest_message;
    if (!room || !latest || latest.id === prior.messageId) continue;
    if (latest.author.kind !== "agent") continue;
    const reply = messagePreview(latest.raw_message);
    if (!reply) continue;
    nextFinished.push({
      messageId: latest.id,
      name: room.direct_peer?.display_name || room.name,
      reply,
      roomId: room.id,
    });
  }
  return { finished: nextFinished, started: nextStarted };
}

function messagePreview(raw: string) {
  const preview = markdownPlainText(raw).trim();
  return preview.length > previewLimit
    ? `${preview.slice(0, previewLimit)}…`
    : preview;
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
