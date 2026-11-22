import { useSyncExternalStore } from "react";

import { useT } from "@/i18n/use-translation";

import type { RoomDocumentCollaborationSession } from "../room-document-collaboration";
import { RoomDocumentSaveIndicator } from "../unified-document-body";
import { canvasMessages } from "./canvas.messages";

/**
 * The email's state in its header: Drafting while an edit is not durable
 * yet, Saved once it is, Sent for good once delivered. Connection and save
 * problems keep the shared save indicator.
 */
export function MailCanvasStatus({
  isEditing,
  sent,
  session,
}: {
  isEditing: boolean;
  sent: boolean;
  session: RoomDocumentCollaborationSession;
}) {
  const t = useT();
  const save = useSyncExternalStore(
    session.subscribeSaveState,
    session.getSaveSnapshot,
    session.getSaveSnapshot,
  );
  if (sent)
    return (
      <span aria-label={t(canvasMessages.emailStatus)} role="status">
        {t(canvasMessages.sent)}
      </span>
    );
  if (save.protocolError === undefined) {
    if (save.status === "Saved")
      return (
        <span aria-label={t(canvasMessages.emailStatus)} role="status">
          {t(canvasMessages.saved)}
        </span>
      );
    if (save.status === "Local pending" || save.status === "Synced")
      return (
        <span aria-label={t(canvasMessages.emailStatus)} role="status">
          {t(canvasMessages.drafting)}
        </span>
      );
    if (save.status === "Connecting") return null;
  }
  return (
    <RoomDocumentSaveIndicator
      alwaysVisible
      isEditing={isEditing}
      session={session}
    />
  );
}
