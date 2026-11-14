/** A box's vertical extent in viewport coordinates, as a rect reports it. */
export interface PocketNoteJumpRect {
  top: number;
  bottom: number;
}

/**
 * Whether today's page sits outside the list's viewport, so the jump earns its
 * place there. A page that is only partly showing still counts as out of view,
 * and a list without the page renders no action at all.
 */
export function todayNoteOutOfView(
  container: PocketNoteJumpRect | null | undefined,
  card: PocketNoteJumpRect | null | undefined,
): boolean {
  if (!container || !card) return false;
  return card.top < container.top || card.bottom > container.bottom;
}
