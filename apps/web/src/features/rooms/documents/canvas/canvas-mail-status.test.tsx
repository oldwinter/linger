import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RoomDocumentCollaborationSession } from "../room-document-collaboration";
import type { RoomDocumentSaveSnapshot } from "../room-document-save-tracker";
import { MailCanvasStatus } from "./canvas-mail-status";

function session(status: RoomDocumentSaveSnapshot["status"]) {
  const snapshot = { canEdit: true, status } as RoomDocumentSaveSnapshot;
  return {
    getSaveSnapshot: () => snapshot,
    readOnly: false,
    subscribeSaveState: () => () => {},
  } as unknown as RoomDocumentCollaborationSession;
}

describe("Mail canvas status", () => {
  it.each([
    ["Local pending", "Drafting"],
    ["Synced", "Drafting"],
    ["Saved", "Saved"],
  ] as const)("reads %s as %s", (status, label) => {
    render(
      <MailCanvasStatus isEditing sent={false} session={session(status)} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(label);
  });

  it("reads Sent once delivered, whatever the save state", () => {
    render(
      <MailCanvasStatus isEditing sent session={session("Local pending")} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sent");
  });
});
