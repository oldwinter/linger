import { lazy, Suspense, useRef } from "react";
import { useNavigate } from "react-router";
import { useSyncExternalStore } from "react";

import {
  closePocketNote,
  readPocketNoteAnchor,
  readPocketNoteHold,
  subscribePocketNoteHold,
} from "./pocket-note-hold";

const PocketNotePanel = lazy(() => import("./pocket-note-panel"));

/**
 * The open note, kept above the room routes. Moving between rooms changes
 * what is behind it.
 */
export function PocketNoteHost({ accountId }: { accountId?: string } = {}) {
  const hold = useSyncExternalStore(
    subscribePocketNoteHold,
    readPocketNoteHold,
  );
  const anchor = useSyncExternalStore(
    subscribePocketNoteHold,
    readPocketNoteAnchor,
  );
  const navigate = useNavigate();
  const closeRef = useRef<(() => void) | undefined>(undefined);
  if (!hold) return null;
  return (
    <Suspense fallback={null}>
      <PocketNotePanel
        accountId={accountId}
        anchor={anchor}
        anotherMeRoomId={hold.anotherMeRoomId}
        closeRef={closeRef}
        onClose={closePocketNote}
        onOpenChat={
          hold.anotherMeRoomId
            ? () => {
                const roomId = hold.anotherMeRoomId;
                if (!roomId) return;
                closePocketNote();
                void navigate(
                  `/t/${encodeURIComponent(hold.tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`,
                );
              }
            : undefined
        }
        tenantId={hold.tenantId}
      />
    </Suspense>
  );
}
