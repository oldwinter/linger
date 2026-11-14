import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { createTeamHubMessageContent } from "@/features/teamhub/teamhub-message-content";

/** The chat message that carries today's Pocket note to Another Me. */
export function pocketTellMessage(note: string): string {
  return `From today's Pocket note:\n\n${note.trim()}`;
}

/**
 * Posts today's note into Another Me's room. The same idempotency key replays
 * one send, so a retry does not leave a second copy.
 */
export async function sendPocketNoteToAnotherMe(input: {
  client: TeamHubClient;
  idempotencyKey: string;
  note: string;
  roomId: string;
}) {
  const content = createTeamHubMessageContent({
    files: [],
    mentions: [],
    text: pocketTellMessage(input.note),
  });
  await teamHubData(
    input.client.api.POST("/v0/rooms/{roomId}/messages", {
      body: content,
      params: {
        header: idempotencyHeader(input.idempotencyKey),
        path: { roomId: input.roomId },
      },
    }),
  );
}
