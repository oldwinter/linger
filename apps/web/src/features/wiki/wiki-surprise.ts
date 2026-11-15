/**
 * The index of a random Wiki page to open, or undefined when there is none.
 * With more than one page the page already on screen is skipped, so the action
 * always takes the reader somewhere new. `random` is passed in so a caller can
 * make the choice repeatable.
 */
export function wikiSurpriseIndex(input: {
  count: number;
  /** Position of the page on screen, when the action sits beside one. */
  currentIndex?: number;
  random: () => number;
}): number | undefined {
  const { count, currentIndex, random } = input;
  if (count <= 0) return undefined;
  if (count === 1) return 0;
  const skip =
    currentIndex !== undefined && currentIndex >= 0 && currentIndex < count
      ? currentIndex
      : undefined;
  const candidates = skip === undefined ? count : count - 1;
  const pick = Math.min(Math.floor(random() * candidates), candidates - 1);
  return skip !== undefined && pick >= skip ? pick + 1 : pick;
}
