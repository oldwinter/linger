// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyMeetingTranscriptMarks,
  scrollMeetingTranscriptTurn,
} from "./meeting-transcript-highlight";
import { searchMeetingTranscript } from "./meeting-transcript-search";

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const scope = globalThis as {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: unknown;
};

const turns = [
  "Blinks, blinks, and records.",
  "Records nothing.",
  "Nothing here.",
];

function transcriptDom(lines: readonly string[]) {
  document.body.innerHTML = `
    <section data-meeting-scroll>
      <div class="transcript">
        ${lines
          .map(
            (line) =>
              `<div class="bn-block-content" data-content-type="paragraph"><p>${line}</p></div>`,
          )
          .join("")}
      </div>
    </section>`;
  const scroller = document.querySelector<HTMLElement>(
    "[data-meeting-scroll]",
  )!;
  const root = document.querySelector<HTMLElement>(".transcript")!;
  return { root, scroller };
}

function registerHighlightSupport() {
  const registry = new Map<string, unknown>();
  scope.CSS = { highlights: registry };
  scope.Highlight = FakeHighlight;
  return registry;
}

afterEach(() => {
  delete scope.CSS;
  delete scope.Highlight;
  document.body.innerHTML = "";
});

describe("applyMeetingTranscriptMarks", () => {
  it("marks every query word and separates the current match", () => {
    const registry = registerHighlightSupport();
    const { root } = transcriptDom(turns);
    const match = searchMeetingTranscript(turns, "records");

    const cleanup = applyMeetingTranscriptMarks({
      current: 0,
      match,
      root,
      turns,
    });

    expect(
      (registry.get("meeting-transcript-current") as FakeHighlight).ranges.map(
        (range) => range.toString(),
      ),
    ).toEqual(["records"]);
    expect(
      (registry.get("meeting-transcript-match") as FakeHighlight).ranges.map(
        (range) => range.toString(),
      ),
    ).toEqual(["Records"]);

    cleanup();
    expect(registry.has("meeting-transcript-match")).toBe(false);
    expect(registry.has("meeting-transcript-current")).toBe(false);
  });

  it("marks only the reading turns, not every word in the document", () => {
    const registry = registerHighlightSupport();
    const { root } = transcriptDom(turns);
    const match = searchMeetingTranscript(turns, "blinks");

    const cleanup = applyMeetingTranscriptMarks({
      current: 0,
      match,
      root,
      turns,
    });

    expect(
      (registry.get("meeting-transcript-current") as FakeHighlight).ranges.map(
        (range) => range.toString(),
      ),
    ).toEqual(["Blinks", "blinks"]);

    cleanup();
  });

  it("paints nothing when the document does not line up with the turns", () => {
    const registry = registerHighlightSupport();
    const { root } = transcriptDom(turns.slice(0, 2));
    const match = searchMeetingTranscript(turns, "records");

    applyMeetingTranscriptMarks({ current: 0, match, root, turns })();

    expect(registry.size).toBe(0);
  });

  it("paints nothing without the CSS Custom Highlight API", () => {
    const { root } = transcriptDom(turns);
    const match = searchMeetingTranscript(turns, "records");

    expect(() =>
      applyMeetingTranscriptMarks({ current: 0, match, root, turns }),
    ).not.toThrow();
  });
});

describe("scrollMeetingTranscriptTurn", () => {
  it("moves the meeting's own scroll area and never the page", () => {
    const { root, scroller } = transcriptDom(turns);
    const blocks = root.querySelectorAll<HTMLElement>(
      '[data-content-type="paragraph"]',
    );
    let scrollTop = 0;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    scroller.getBoundingClientRect = () =>
      ({ bottom: 100, top: 0 }) as unknown as DOMRect;
    blocks[0]!.getBoundingClientRect = () =>
      ({ bottom: 20, top: 10 }) as unknown as DOMRect;
    blocks[1]!.getBoundingClientRect = () =>
      ({ bottom: 220, top: 200 }) as unknown as DOMRect;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    scrollMeetingTranscriptTurn(root, 0, turns.length);
    expect(scrollTop).toBe(0);
    scrollMeetingTranscriptTurn(root, 1, turns.length);
    expect(scrollTop).toBe(120);
    expect(scrollIntoView).not.toHaveBeenCalled();

    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });
});
