import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Only the local rules are needed; jsdom cannot load Tailwind's CSS import.
const navigationStyles = readFileSync(
  resolve(import.meta.dirname, "../../app/globals.css"),
  "utf8",
).replace(/^@import .*;$/gm, "");
let stylesheet: HTMLStyleElement;

// The shared test setup removes head nodes after each test, so each test
// attaches its own copy.
beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = navigationStyles;
  document.head.append(stylesheet);
});

describe("collapsed navigation hover targets", () => {
  it.each([
    ".room-rail-link:hover",
    ".room-rail-link:has(~ .room-rail-link:hover)",
    ".room-rail-link:hover ~ .room-rail-link",
  ])("keeps the hit area stationary for %s", (selector) => {
    // jsdom has no hit testing. Guard the CSS invariant that prevents a fixed
    // pointer from losing hover, restoring the target, and gaining hover again.
    const rules = styleRules(stylesheet.sheet!.cssRules).filter((rule) =>
      rule.selectorText.replace(/\s+/g, " ").endsWith(selector),
    );
    for (const rule of rules) {
      expect(rule.style.transform || "none").toBe("none");
      expect(rule.style.getPropertyValue("translate") || "none").toBe("none");
    }
  });

  it.each([":hover", ":focus-visible"])(
    "still reveals the compact label on %s",
    (state) => {
      const selector = `.app-navigation[data-expanded="false"] .room-rail-link${state}`;
      const rules = styleRules(stylesheet.sheet!.cssRules);
      const link = rules.find(
        (rule) => rule.selectorText.replace(/\s+/g, " ") === selector,
      );
      const label = rules.find(
        (rule) =>
          rule.selectorText.replace(/\s+/g, " ") ===
          `${selector} .primary-navigation-label`,
      );
      expect(link?.style.width).toBe("max-content");
      expect(label?.style.opacity).toBe("1");
    },
  );

  it("centers 44px mobile rail targets and allocates desktop and touch message action slots", () => {
    const rules = Array.from(stylesheet.sheet!.cssRules);
    const mobileRailMedia = rules.find(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule &&
        rule.conditionText.includes("max-width: 767px") &&
        rule.conditionText.includes("pointer: coarse"),
    );
    const mobileItemsRule = mobileRailMedia
      ? styleRules(mobileRailMedia.cssRules).find(
          (rule) =>
            rule.selectorText.replace(/\s+/g, " ") ===
            ".primary-navigation-items",
        )
      : undefined;
    expect(mobileItemsRule?.style.getPropertyValue("padding-inline")).toBe(
      "6px",
    );

    const desktopMessageRule = styleRules(stylesheet.sheet!.cssRules).find(
      (rule) => rule.selectorText === ".room-message-card",
    );
    expect(
      desktopMessageRule?.style.getPropertyValue("--message-actions-room"),
    ).toBe("112px");

    const coarseCardRule = rules
      .filter(
        (rule): rule is CSSMediaRule =>
          rule instanceof CSSMediaRule &&
          rule.conditionText.includes("pointer: coarse"),
      )
      .flatMap((rule) => styleRules(rule.cssRules))
      .find((rule) => rule.selectorText === ".room-message-card");
    expect(
      coarseCardRule?.style.getPropertyValue("--message-actions-room"),
    ).toBe("0px");
  });
});

function styleRules(rules: CSSRuleList): CSSStyleRule[] {
  return Array.from(rules).flatMap((rule) => {
    if (rule instanceof CSSStyleRule) return [rule];
    if ("cssRules" in rule)
      return styleRules((rule as CSSGroupingRule).cssRules);
    return [];
  });
}
