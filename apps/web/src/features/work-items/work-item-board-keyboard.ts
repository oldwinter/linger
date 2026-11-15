/** Which way one board key moves the focus ring. */
export type WorkItemBoardMove = "next" | "previous";

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
