import { useSyncExternalStore } from "react";

import {
  readRoomComposerDraft,
  subscribeRoomComposerDrafts,
  type RoomDraftScope,
} from "../room-drafts";

/** The words still in the composer, or nothing when the seat is empty. */
export function writingSeatText(body: string | undefined): string | undefined {
  const text = body?.trim();
  return text ? text : undefined;
}

/** The main Room composer's unsent words, updated as they are written. */
export function useWritingSeat(scope: RoomDraftScope): string | undefined {
  return useSyncExternalStore(subscribeRoomComposerDrafts, () =>
    writingSeatText(readRoomComposerDraft(scope).body),
  );
}
