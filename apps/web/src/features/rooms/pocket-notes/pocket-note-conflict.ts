import { appendToPocketNote } from "./pocket-note-append";
import {
  isPocketNoteConflictError,
  POCKET_NOTE_CONFLICT_CODE,
} from "./pocket-note-queries";

export { isPocketNoteConflictError, POCKET_NOTE_CONFLICT_CODE };

/**
 * Combines the latest server version and the local unsaved draft without
 * dropping either writer's words. When both writers extended the same base
 * text, the shared base is kept once and the local addition follows the server
 * update.
 */
export function mergePocketNoteConflict(input: {
  baseText: string;
  localText: string;
  maxLength?: number;
  serverText: string;
}): { text: string; truncated: boolean } {
  const { baseText, localText, maxLength, serverText } = input;
  let merged: string;
  if (localText === serverText) {
    merged = serverText;
  } else if (!serverText.trim()) {
    merged = localText;
  } else if (!localText.trim()) {
    merged = serverText;
  } else if (localText.startsWith(serverText)) {
    merged = localText;
  } else if (serverText.startsWith(localText)) {
    merged = serverText;
  } else if (
    baseText.length > 0 &&
    serverText.startsWith(baseText) &&
    localText.startsWith(baseText)
  ) {
    const localAddition = localText.slice(baseText.length).trim();
    merged =
      localAddition && !serverText.includes(localAddition)
        ? appendToPocketNote(serverText, localAddition)
        : serverText;
  } else {
    merged = appendToPocketNote(serverText, localText);
  }
  if (maxLength !== undefined && merged.length > maxLength) {
    return { text: merged.slice(0, maxLength), truncated: true };
  }
  return { text: merged, truncated: false };
}
