import type { MeetingTranscriptMatch } from "./meeting-transcript-search";

const MATCH_HIGHLIGHT = "meeting-transcript-match";
const CURRENT_MATCH_HIGHLIGHT = "meeting-transcript-current";

type HighlightRegistry = Map<string, unknown>;
type HighlightConstructor = new (...ranges: Range[]) => unknown;

function highlightSupport(): {
  registry: HighlightRegistry;
  Highlight: HighlightConstructor;
} | null {
  const scope = globalThis as {
    CSS?: { highlights?: HighlightRegistry };
    Highlight?: HighlightConstructor;
  };
  if (!scope.CSS?.highlights || typeof scope.Highlight !== "function") {
    return null;
  }
  return { registry: scope.CSS.highlights, Highlight: scope.Highlight };
}

/** The rendered transcript's turns: one paragraph block per spoken turn. */
function turnBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      '.bn-block-content[data-content-type="paragraph"]',
    ),
  );
}

/**
 * Paints every query word inside the matching turns, the current turn apart so
 * Previous and Next visibly land somewhere. It registers CSS Custom Highlight
 * ranges instead of touching the rendered document, so the transcript's text
 * and React's rendering stay as they were; browsers without the API simply
 * show no marks. Returns the cleanup that removes them.
 */
export function applyMeetingTranscriptMarks({
  current,
  match,
  root,
  turns,
}: {
  current: number;
  match: MeetingTranscriptMatch;
  root: HTMLElement;
  turns: readonly string[];
}): () => void {
  const support = highlightSupport();
  if (!support || !match.words.length) return () => {};
  const blocks = turnBlocks(root);
  // The document and the turn projection disagree on what a turn is; marking
  // by position would decorate the wrong words, so paint nothing.
  if (blocks.length !== turns.length) return () => {};
  const ranges: Range[] = [];
  const currentRanges: Range[] = [];
  match.indices.forEach((turnIndex, position) => {
    const block = blocks[turnIndex];
    if (!block) return;
    const target = position === current ? currentRanges : ranges;
    target.push(...wordRanges(block, match.words));
  });
  support.registry.set(MATCH_HIGHLIGHT, new support.Highlight(...ranges));
  if (currentRanges.length) {
    support.registry.set(
      CURRENT_MATCH_HIGHLIGHT,
      new support.Highlight(...currentRanges),
    );
  } else {
    support.registry.delete(CURRENT_MATCH_HIGHLIGHT);
  }
  return () => {
    support.registry.delete(MATCH_HIGHLIGHT);
    support.registry.delete(CURRENT_MATCH_HIGHLIGHT);
  };
}

/**
 * Scrolls one turn into view inside the meeting's own scroll area. Moving
 * between matches must not move the page or another panel, so it adjusts that
 * container's scrollTop instead of calling scrollIntoView.
 */
const SPOKEN_NOW = "data-spoken-now";

/**
 * Marks the paragraph for the turn being spoken. A mismatch between the
 * rendered blocks and the turn list clears the mark instead of guessing.
 */
export function markSpokenTurn(
  root: HTMLElement,
  index: number | undefined,
  turnCount: number,
) {
  const blocks = turnBlocks(root);
  const aligned = blocks.length === turnCount;
  blocks.forEach((block, blockIndex) => {
    if (aligned && blockIndex === index) block.setAttribute(SPOKEN_NOW, "");
    else block.removeAttribute(SPOKEN_NOW);
  });
}

export function scrollMeetingTranscriptTurn(
  root: HTMLElement,
  turnIndex: number,
  turnCount: number,
): void {
  const blocks = turnBlocks(root);
  if (blocks.length !== turnCount) return;
  const block = blocks[turnIndex];
  const scroller = root.closest<HTMLElement>("[data-meeting-scroll]");
  if (!block || !scroller) return;
  const blockRect = block.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  if (blockRect.top < scrollerRect.top) {
    scroller.scrollTop += blockRect.top - scrollerRect.top;
  } else if (blockRect.bottom > scrollerRect.bottom) {
    scroller.scrollTop += blockRect.bottom - scrollerRect.bottom;
  }
}

function wordRanges(block: HTMLElement, words: readonly string[]): Range[] {
  const ownerDocument = block.ownerDocument;
  const walker = ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const ranges: Range[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const lower = text.toLowerCase();
    for (const word of words) {
      let index = lower.indexOf(word);
      while (index >= 0) {
        const range = ownerDocument.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + word.length);
        ranges.push(range);
        index = lower.indexOf(word, index + word.length);
      }
    }
  }
  return ranges;
}
