import { useEffect, useState } from "react";

import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { useAnotherMeQuiet } from "./another-me-quiet";

const BODY_LIMIT = 160;

export interface AnotherMeArrival {
  actorId: string;
  messageId: string;
  name: string;
  text: string;
}

export interface AnotherMeArrivalInput {
  agentActorId?: string;
  dismissedId?: string;
  /** Quiet hours or a pause already holds Another Me's notices. */
  held: boolean;
  /** The person is already in Another Me's chat. */
  here: boolean;
  latest?: {
    authorId: string;
    authorName: string;
    id: string;
    raw: string;
  };
  /** Undefined until the first reading, which only records where to start. */
  seenId: string | null | undefined;
}

/**
 * Another Me's new words, when the person is somewhere else in the app.
 * The first reading only marks the latest message, so opening the app never
 * replays an old one.
 */
export function anotherMeArrival(
  input: AnotherMeArrivalInput,
): AnotherMeArrival | undefined {
  const { agentActorId, latest } = input;
  if (
    input.seenId === undefined ||
    input.held ||
    input.here ||
    !agentActorId ||
    !latest ||
    latest.authorId !== agentActorId
  ) {
    return;
  }
  if (latest.id === input.seenId || latest.id === input.dismissedId) return;
  const text = markdownPlainText(latest.raw).trim();
  if (!text) return;
  return {
    actorId: agentActorId,
    messageId: latest.id,
    name: latest.authorName.trim() || "Another Me",
    text: text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}…` : text,
  };
}

/** Watches Another Me's chat and surfaces a new message away from that room. */
export function useAnotherMeArrival({
  accountId,
  activeRoomId,
  agentActorId,
  anotherMeRoomId,
  rooms,
}: {
  accountId?: string;
  activeRoomId?: string;
  agentActorId?: string;
  anotherMeRoomId?: string;
  rooms: readonly TeamHubRoomListItem[] | undefined;
}) {
  const quiet = useAnotherMeQuiet(accountId);
  const [seenId, setSeenId] = useState<string | null | undefined>(undefined);
  const [dismissedId, setDismissedId] = useState<string>();
  const room = anotherMeRoomId
    ? rooms?.find((item) => item.id === anotherMeRoomId)
    : undefined;
  const latest = room?.latest_message;
  const here = Boolean(anotherMeRoomId && activeRoomId === anotherMeRoomId);

  useEffect(() => {
    if (!rooms || !anotherMeRoomId) return;
    const id = latest?.id ?? null;
    if (seenId === undefined) {
      setSeenId(id);
      return;
    }
    if (here && id !== seenId) setSeenId(id);
  }, [anotherMeRoomId, here, latest?.id, rooms, seenId]);

  const arrival = anotherMeArrival({
    agentActorId,
    dismissedId,
    held: quiet.until !== undefined,
    here,
    latest: latest
      ? {
          authorId: latest.author.id,
          authorName: latest.author.display_name,
          id: latest.id,
          raw: latest.raw_message,
        }
      : undefined,
    seenId,
  });
  return {
    arrival,
    dismiss() {
      if (arrival) setDismissedId(arrival.messageId);
    },
  };
}
