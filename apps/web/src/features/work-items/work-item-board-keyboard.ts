/** Which way one board key moves the focus ring. */
export type WorkItemBoardMove = "next" | "previous";

/**
 * Controls whose own keys win over the board's. A board key pressed here would
 * otherwise move the ring while the person types or chooses.
 */
const fieldSelector = [
  "input",
  "textarea",
  "select",
  "dialog",
  "[contenteditable='true']",
  "[role='menu']",
  "[role='listbox']",
  "[role='alertdialog']",
  "[role='dialog']",
].join(", ");

const openOverlaySelector =
  "dialog[open], [role='menu'], [role='listbox'], [role='alertdialog']";

/**
 * The card a move lands on. With nothing marked, either direction starts at the
 * first card; at each end the mark stays put instead of wrapping, the same way
 * the document trees clamp their arrow keys.
 */
export function nextWorkItemCardId(
  cardIds: readonly string[],
  focusedCardId: string | undefined,
  move: WorkItemBoardMove,
): string | undefined {
  if (cardIds.length === 0) return undefined;
  const current =
    focusedCardId === undefined ? -1 : cardIds.indexOf(focusedCardId);
  if (current < 0) return cardIds[0];
  const step = move === "next" ? 1 : -1;
  const index = Math.min(Math.max(current + step, 0), cardIds.length - 1);
  return cardIds[index];
}

/** The move a key asks for, or undefined for a key the board leaves alone. */
export function workItemBoardMoveForKey(
  key: string,
): WorkItemBoardMove | undefined {
  if (key === "j" || key === "ArrowDown") return "next";
  if (key === "k" || key === "ArrowUp") return "previous";
  return undefined;
}

/**
 * Whether a key event belongs to the board rather than to a field, a menu, or an
 * open dialog. A chord with any modifier, an IME composition in flight, and an
 * event another control already handled all stay with their owner.
 */
export function isWorkItemBoardKeyEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return false;
    if (target.closest(fieldSelector)) return false;
  }
  return !document.querySelector(openOverlaySelector);
}
