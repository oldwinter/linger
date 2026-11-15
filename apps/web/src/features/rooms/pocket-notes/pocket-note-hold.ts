/**
 * An open Pocket note lives above the room routes, so leaving a room does not
 * close the page the person is writing.
 */
export interface PocketNoteHold {
  anotherMeRoomId?: string;
  tenantId: string;
}

let hold: PocketNoteHold | undefined;
let anchor: HTMLButtonElement | null = null;
let closeNote: (() => void) | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribePocketNoteHold(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readPocketNoteHold() {
  return hold;
}

export function readPocketNoteAnchor() {
  return anchor;
}

export function openPocketNote(next: PocketNoteHold) {
  hold = next;
  emit();
}

export function closePocketNote() {
  if (!hold) return;
  hold = undefined;
  emit();
}

/** The panel's own close, so a later click can settle dictation first. */
export function registerPocketNoteClose(close: (() => void) | undefined) {
  closeNote = close;
}

export function requestPocketNoteClose() {
  if (closeNote) closeNote();
  else closePocketNote();
}

export function registerPocketNoteAnchor(button: HTMLButtonElement | null) {
  if (anchor === button) return;
  anchor = button;
  emit();
}
