import { describe, expect, it } from "vitest";

import { wikiWritingExcerpt, wikiWritingPages } from "./wiki-writing-walk";

const atlas = `---\n${JSON.stringify({ type: "Project", title: "Project Atlas", description: "Delivery analytics migration" })}\n---\n\n# Project Atlas\n\nBudget USD 210,000.\n`;
const tom = `---\n${JSON.stringify({ type: "Contact", title: "Tom Becker", description: "Northwind sponsor" })}\n---\n\n# Tom Becker\n\nSponsors the rollout.\n`;

describe("wiki writing walk", () => {
  it("orders written pages by name and keeps the prose under the title", () => {
    expect(
      wikiWritingPages({
        "contacts/tom.md": tom,
        "projects/atlas.md": atlas,
      }).map((page) => [page.name, page.collectionLabel, page.excerpt]),
    ).toEqual([
      ["Project Atlas", "Projects", "Budget USD 210,000."],
      ["Tom Becker", "People", "Sponsors the rollout."],
    ]);
  });

  it("drops a long body after the excerpt limit", () => {
    const excerpt = wikiWritingExcerpt(`# Title\n\n${"word ".repeat(80)}`);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(241);
  });
});
