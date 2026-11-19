import { useSyncExternalStore } from "react";

import type { RoomDocumentCollaborationSession } from "../room-document-collaboration";
import { RoomDocumentSaveIndicator } from "../unified-document-body";

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
  const save = useSyncExternalStore(
    session.subscribeSaveState,
    session.getSaveSnapshot,
    session.getSaveSnapshot,
  );
  if (sent)
    return (
      <span aria-label="Email status" role="status">
        Sent
      </span>
    );
  if (save.protocolError === undefined) {
    if (save.status === "Saved")
      return (
        <span aria-label="Email status" role="status">
          Saved
        </span>
      );
    if (save.status === "Local pending" || save.status === "Synced")
      return (
        <span aria-label="Email status" role="status">
          Drafting
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
