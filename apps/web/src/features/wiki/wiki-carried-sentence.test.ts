import { describe, expect, it } from "vitest";

import type {
  WikiGraphData,
  WikiGraphNode,
} from "@/features/memory/wiki-graph-model";

import { wikiCarriedSentence } from "./wiki-carried-sentence";

function node(id: string, body: string): WikiGraphNode {
  return {
    backlinks: [],
    body,
    category: "Topic",
    description: "",
    id,
    links: [],
    size: body.length,
    tags: [],
    title: id,
  };
}

function graph(nodes: WikiGraphNode[]): WikiGraphData {
  return { edges: [], nodes, types: [] };
}

const shared = "The release stayed small enough for one person to hold.";

describe("wikiCarriedSentence", () => {
  it("carries the sentence that follows the line the two pages share", () => {
    expect(
      wikiCarriedSentence(
        "topics/release",
        graph([
          node("topics/release", `${shared} The notes stop there.`),
          node(
            "projects/lev8",
            `Intro. ${shared} Ada kept the rest of the week clear.`,
          ),
        ]),
      ),
    ).toBe("Ada kept the rest of the week clear.");
  });

  it("stays quiet when a third page says the line or the next sentence is already here", () => {
    const third = node("contacts/ada", shared);
    expect(
      wikiCarriedSentence(
        "topics/release",
        graph([
          node("topics/release", shared),
          node("projects/lev8", `${shared} Ada kept the week clear.`),
          third,
        ]),
      ),
    ).toBeUndefined();
    expect(
      wikiCarriedSentence(
        "topics/release",
        graph([
          node(
            "topics/release",
            `${shared} Ada kept the rest of the week clear.`,
          ),
          node(
            "projects/lev8",
            `${shared} Ada kept the rest of the week clear.`,
          ),
        ]),
      ),
    ).toBeUndefined();
  });
});
