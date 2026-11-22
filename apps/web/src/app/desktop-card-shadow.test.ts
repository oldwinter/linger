// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Only the local rules are needed; jsdom cannot load Tailwind's CSS import.
const appStyles = readFileSync(
  resolve(import.meta.dirname, "globals.css"),
  "utf8",
).replace(/^@import .*;$/gm, "");
let stylesheet: HTMLStyleElement;

// The shared test setup removes head nodes after each test.
beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = appStyles;
  document.head.append(stylesheet);
});

const shell = ":root[data-desktop-shell]";

// jsdom paints nothing, so guard the CSS that lets the desktop card's shadow
// show on its left edge, as it does on the other three.
describe("desktop page card shadow", () => {
  it("leaves the navigation beside the card unpainted", () => {
    for (const element of [".app-navigation", ".app-primary-navigation"]) {
      const painted = desktopRules(`${shell} ${element}`).filter(
        (rule) =>
          (rule.style.background || rule.style.backgroundColor) !== "" &&
          (rule.style.background || rule.style.backgroundColor) !==
            "transparent",
      );
      expect(painted.map((rule) => rule.selectorText)).toEqual([]);
    }
    expect(
      desktopRules(`${shell} .app-navigation .app-secondary-navigation`).some(
        (rule) => rule.style.background === "var(--app-sidebar)",
      ),
    ).toBe(true);
  });

  it("does not clip the Library card's shadow", () => {
    const layout = desktopRules(`${shell} .library-layout`);
    expect(layout.some((rule) => rule.style.overflow === "visible")).toBe(true);
    const card = desktopRules(`${shell} .library-layout-body`);
    expect(card.some((rule) => rule.style.boxShadow !== "")).toBe(true);
  });
});

// Rules in the desktop media block whose selector list holds exactly this
// selector.
function desktopRules(selector: string): CSSStyleRule[] {
  return styleRules(stylesheet.sheet!.cssRules).filter((rule) =>
    rule.selectorText
      .split(",")
      .some((part) => part.replace(/\s+/g, " ").trim() === selector),
  );
}

function styleRules(rules: CSSRuleList): CSSStyleRule[] {
  return Array.from(rules).flatMap((rule) => {
    if (rule instanceof CSSStyleRule) return [rule];
    if ("cssRules" in rule)
      return styleRules((rule as CSSGroupingRule).cssRules);
    return [];
  });
}
