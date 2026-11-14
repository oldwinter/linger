import { describe, expect, it } from "vitest";

import {
  nextWorkItemCardId,
  workItemBoardMoveForKey,
} from "./work-item-board-keyboard";

const cards = ["card-a", "card-b", "card-c"];

describe("nextWorkItemCardId", () => {
  it("moves forward one card at a time", () => {
    expect(nextWorkItemCardId(cards, "card-a", "next")).toBe("card-b");
    expect(nextWorkItemCardId(cards, "card-b", "next")).toBe("card-c");
  });

  it("moves backward one card at a time", () => {
    expect(nextWorkItemCardId(cards, "card-c", "previous")).toBe("card-b");
    expect(nextWorkItemCardId(cards, "card-b", "previous")).toBe("card-a");
  });

  it("starts at the first card when nothing is marked, either way", () => {
    expect(nextWorkItemCardId(cards, undefined, "next")).toBe("card-a");
    expect(nextWorkItemCardId(cards, undefined, "previous")).toBe("card-a");
  });

  it("stops at each end instead of wrapping", () => {
    expect(nextWorkItemCardId(cards, "card-c", "next")).toBe("card-c");
    expect(nextWorkItemCardId(cards, "card-a", "previous")).toBe("card-a");
  });

  it("starts over at the first card when the mark is stale", () => {
    expect(nextWorkItemCardId(cards, "card-gone", "previous")).toBe("card-a");
  });

  it("returns no card for an empty board", () => {
    expect(nextWorkItemCardId([], undefined, "next")).toBeUndefined();
  });
});

describe("workItemBoardMoveForKey", () => {
  it("reads j and the down arrow as forward", () => {
    expect(workItemBoardMoveForKey("j")).toBe("next");
    expect(workItemBoardMoveForKey("ArrowDown")).toBe("next");
  });

  it("reads k and the up arrow as backward", () => {
    expect(workItemBoardMoveForKey("k")).toBe("previous");
    expect(workItemBoardMoveForKey("ArrowUp")).toBe("previous");
  });

  it("leaves every other key alone", () => {
    expect(workItemBoardMoveForKey("Enter")).toBeUndefined();
    expect(workItemBoardMoveForKey("Escape")).toBeUndefined();
    expect(workItemBoardMoveForKey("J")).toBeUndefined();
    expect(workItemBoardMoveForKey("x")).toBeUndefined();
  });
});
