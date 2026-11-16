// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { readingPlace, readingPlaceDelta } from "./room-document-reading-place";

function rect(top: number): DOMRect {
  return {
    bottom: top + 20,
    height: 20,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON() {
      return {};
    },
  };
}

function scrollportWith(blockTop: number, scrollTop: number) {
  const scrollport = document.createElement("div");
  const block = document.createElement("div");
  block.className = "bn-block-outer";
  block.dataset.id = "block-a";
  scrollport.append(block);
  scrollport.getBoundingClientRect = () => rect(0);
  block.getBoundingClientRect = () => rect(blockTop);
  Object.defineProperty(scrollport, "scrollTop", {
    configurable: true,
    value: scrollTop,
    writable: true,
  });
  return { block, scrollport };
}

describe("readingPlace", () => {
  it("remembers the block at the top of the scrollport", () => {
    const { scrollport } = scrollportWith(40, 200);
    expect(readingPlace(scrollport)).toEqual({
      blockId: "block-a",
      offset: 40,
    });
  });

  it("leaves the top of the file free to show new words", () => {
    const { scrollport } = scrollportWith(0, 0);
    expect(readingPlace(scrollport)).toBeUndefined();
  });
});

describe("readingPlaceDelta", () => {
  it("moves the scrollport by how far the block was pushed", () => {
    const { block, scrollport } = scrollportWith(120, 200);
    expect(
      readingPlaceDelta(scrollport, { blockId: "block-a", offset: 40 }),
    ).toBe(80);
    block.remove();
    expect(
      readingPlaceDelta(scrollport, { blockId: "block-a", offset: 40 }),
    ).toBeUndefined();
  });
});
