export function stepOutPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/step-out`;
}

/** Direct chats and threads stay with you. Only a regular room can go quiet. */
export function canStepOut(kind: string) {
  return kind === "room";
}
