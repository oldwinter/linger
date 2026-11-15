// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { markSpokenTurn } from "./meeting-transcript-highlight";

describe("markSpokenTurn", () => {
  it("marks the paragraph for the turn being spoken", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      '<div class="bn-block-content" data-content-type="paragraph">First</div>',
      '<div class="bn-block-content" data-content-type="paragraph">Second</div>',
    ].join("");
    markSpokenTurn(root, 1, 2);
    const blocks = root.querySelectorAll("[data-content-type='paragraph']");
    expect(blocks[0]?.hasAttribute("data-spoken-now")).toBe(false);
    expect(blocks[1]?.getAttribute("data-spoken-now")).toBe("");
    markSpokenTurn(root, undefined, 2);
    expect(root.querySelector("[data-spoken-now]")).toBeNull();
  });

  it("clears the mark when the rendered turns do not match", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="bn-block-content" data-content-type="paragraph" data-spoken-now="">First</div>';
    markSpokenTurn(root, 0, 2);
    expect(root.querySelector("[data-spoken-now]")).toBeNull();
  });
});
