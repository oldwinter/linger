import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon, type IconSvgElement } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { roomListMessages } from "../room-list.messages";

import {
  openPocketNote,
  readPocketNoteHold,
  registerPocketNoteAnchor,
  requestPocketNoteClose,
  subscribePocketNoteHold,
} from "./pocket-note-hold";

const stroke = {
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: "1.5",
};
// A pencil writing a wavy line: no page outline, so it reads apart from the
// Meeting icon's paper. Drawn on Hugeicons' 24px grid with its 1.5 stroke.
const noteWriteIcon: IconSvgElement = [
  "M15.2 3.8C15.9 3.1 17.1 3.1 17.8 3.8L19.2 5.2C19.9 5.9 19.9 7.1 19.2 7.8L9.5 17.5L5 18.5L6 14L15.2 3.8Z",
  "M13.5 5.8L17.2 9.5",
  "M4 21.5C5.6 20.3 7 20.3 8.4 21.4C9.8 22.5 11.2 22.5 12.7 21.4C14.2 20.3 15.6 20.3 17 21.2",
].map((d, index) => ["path", { d, ...stroke, key: String(index) }]);

/**
 * Always-visible toolbar action opens today's Pocket Note, with all pages
 * one click away. The open page stays up when this button leaves with a room.
 */
export function PocketNoteLauncher({
  anotherMeRoomId,
  onOpen,
  tenantId,
}: {
  anotherMeRoomId?: string;
  onOpen?: () => void;
  tenantId: string;
}) {
  const t = useT();
  const hold = useSyncExternalStore(
    subscribePocketNoteHold,
    readPocketNoteHold,
  );
  const open = hold?.tenantId === tenantId;
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  useEffect(() => registerPocketNoteAnchor(button), [button]);
  return (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={t(roomListMessages.pocketNotes)}
      className="xs-nav-btn"
      onClick={() => {
        if (open) {
          requestPocketNoteClose();
          return;
        }
        onOpen?.();
        openPocketNote({ anotherMeRoomId, tenantId });
      }}
      ref={setButton}
      title={t(roomListMessages.pocketNotes)}
      type="button"
    >
      <Icon icon={noteWriteIcon} size={16} />
      <span className="xs-nav-btn-label">
        {t(roomListMessages.pocketNotes)}
      </span>
    </button>
  );
}
