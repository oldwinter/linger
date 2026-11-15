import { describe, expect, it } from "vitest";

import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";

import { pageKeyForHref, wikiReach } from "./wiki-reach";

function node(id: string, title: string, links: string[] = []): WikiGraphNode {
  return {
    backlinks: [],
    body: "",
    category: "Project",
    description: "",
    id,
    links,
    size: 1,
    tags: [],
    title,
  };
}

describe("wikiReach", () => {
  const monday = node("meetings/monday", "Monday", ["people/maya"]);
  const maya = node("people/maya", "Maya", ["projects/alpha"]);
  const alpha = node("projects/alpha", "Alpha");
  const nodes = new Map([
    [monday.id, monday],
    [maya.id, maya],
    [alpha.id, alpha],
  ]);

  it("names the page between the one you left and this one", () => {
    expect(
      wikiReach(nodes, "meetings/monday", "projects/alpha")?.map(
        (page) => page.title,
      ),
    ).toEqual(["Monday", "Maya", "Alpha"]);
  });

  it("stays quiet for a direct link, the same page, or no chain", () => {
    const direct = new Map([
      ["a", node("a", "A", ["b"])],
      ["b", node("b", "B")],
    ]);
    expect(wikiReach(direct, "a", "b")).toBeUndefined();
    expect(
      wikiReach(nodes, "projects/alpha", "projects/alpha"),
    ).toBeUndefined();
    expect(wikiReach(nodes, "projects/alpha", "missing")).toBeUndefined();
  });
});

describe("pageKeyForHref", () => {
  it("finds the page key for a document route", () => {
    const hrefs = new Map([
      ["people/maya", "/t/tenant/documents/maya"],
      ["projects/alpha", "/t/tenant/documents/alpha"],
    ]);
    expect(pageKeyForHref(hrefs, "/t/tenant/documents/maya")).toBe(
      "people/maya",
    );
    expect(pageKeyForHref(hrefs, "/t/tenant/documents/nope")).toBeUndefined();
  });
});
