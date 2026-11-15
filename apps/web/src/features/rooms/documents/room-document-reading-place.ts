/** Ignore a reader parked at the top; new words there should come into view. */
const TOP_SLACK_PX = 24;

export interface ReadingPlace {
  blockId: string;
  /** Block top relative to the scrollport top, before the remote edit. */
  offset: number;
}

/**
 * The block occupying the top of the scrollport, and how far its top sits
 * from that edge. Absent at the top of the file.
 */
export function readingPlace(
  scrollport: HTMLElement,
): ReadingPlace | undefined {
  if (scrollport.scrollTop < TOP_SLACK_PX) return;
  const portTop = scrollport.getBoundingClientRect().top;
  const blocks = scrollport.querySelectorAll<HTMLElement>(
    ".bn-block-outer[data-id]",
  );
  let block: HTMLElement | undefined;
  for (const candidate of blocks) {
    const top = candidate.getBoundingClientRect().top;
    if (top <= portTop + 8) block = candidate;
    else {
      // Padding can leave the first visible block a little below the edge.
      if (!block) block = candidate;
      break;
    }
  }
  const blockId = block?.dataset.id;
  if (!block || !blockId) return;
  return {
    blockId,
    offset: block.getBoundingClientRect().top - portTop,
  };
}

/**
 * How far to move the scrollport so `place` sits where it did before the
 * words above it changed. Undefined when that block is gone.
 */
export function readingPlaceDelta(
  scrollport: HTMLElement,
  place: ReadingPlace,
): number | undefined {
  const block = scrollport.querySelector<HTMLElement>(
    `.bn-block-outer[data-id="${CSS.escape(place.blockId)}"]`,
  );
  if (!block) return;
  const offset =
    block.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
  const delta = offset - place.offset;
  return delta === 0 ? undefined : delta;
}

/**
 * Keeps the block the reader was on in place when someone else's words land
 * above it. Their own typing is left to the editor.
 */
export function bindRemoteReadingPlace(
  editor: {
    onChange: (
      callback: (
        editor: unknown,
        context: {
          getChanges: () => Array<{ source: { type: string } }>;
        },
      ) => void,
    ) => () => void;
  },
  scrollport: HTMLElement,
) {
  let place = readingPlace(scrollport);
  const remember = () => {
    place = readingPlace(scrollport);
  };
  scrollport.addEventListener("scroll", remember, { passive: true });
  const unsubscribe = editor.onChange((_editor, context) => {
    const remote = context
      .getChanges()
      .some((change) => change.source.type === "yjs-remote");
    if (remote && place) {
      const delta = readingPlaceDelta(scrollport, place);
      if (delta) scrollport.scrollTop += delta;
    }
    place = readingPlace(scrollport);
  });
  return () => {
    scrollport.removeEventListener("scroll", remember);
    unsubscribe();
  };
}
