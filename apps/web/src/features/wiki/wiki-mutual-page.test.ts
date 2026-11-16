import { describe, expect, it } from "vitest";

import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";

import { mutualPage } from "./wiki-mutual-page";

function node(id: string, links: string[], body = ""): WikiGraphNode {
  return {
    backlinks: [],
    body,
    category: "Project",
    description: "",
    id,
    links,
    size: 1,
    tags: [],
    title: id,
  };
}

describe("mutualPage", () => {
  it("returns the one page that points back and has words", () => {
    const alpha = node("alpha", ["maya"], "The project.");
    const maya = node("maya", ["alpha"], "Maya keeps the notes.");
    const nodes = new Map([
      [alpha.id, alpha],
      [maya.id, maya],
    ]);
    expect(mutualPage("alpha", nodes)?.id).toBe("maya");
  });

  it("returns nothing for a one-way link, an empty page, or two partners", () => {
    const alpha = node("alpha", ["maya", "jo"]);
    const maya = node("maya", ["alpha"], "Notes.");
    const jo = node("jo", ["alpha"], "Also notes.");
    const oneWay = node("solo", ["alpha"], "Hello.");
    const nodes = new Map([
      [alpha.id, alpha],
      [maya.id, maya],
      [jo.id, jo],
      [oneWay.id, oneWay],
    ]);
    expect(mutualPage("alpha", nodes)).toBeUndefined();
    expect(mutualPage("solo", nodes)).toBeUndefined();
    const quiet = node("quiet", ["alpha"], "   ");
    const paired = node("alpha", ["quiet"]);
    expect(
      mutualPage(
        "alpha",
        new Map([
          [paired.id, paired],
          [quiet.id, quiet],
        ]),
      ),
    ).toBeUndefined();
  });
});
