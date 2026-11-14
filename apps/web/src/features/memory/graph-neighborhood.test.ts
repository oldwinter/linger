import { describe, expect, it } from "vitest";

import type { WikiGraphData, WikiGraphNode } from "./wiki-graph-model";
import { graphNeighborhood } from "./graph-neighborhood";

function node(
  id: string,
  title: string,
  overrides: Partial<WikiGraphNode> = {},
): WikiGraphNode {
  return {
    id,
    title,
    category: "Topic",
    description: "",
    tags: [],
    body: "",
    size: 1,
    links: [],
    backlinks: [],
    ...overrides,
  };
}

const graph: WikiGraphData = {
  types: [],
  nodes: [
    node("sessions/2026-09-01/capture_session_a", "Kickoff meeting"),
    node("projects/lev8", "Lev8 Outbound", {
      backlinks: ["sessions/2026-09-01/capture_session_a"],
      description: "Controlled outreach.",
    }),
    node("topics/method", "Method", {
      description: "The Lev8 method.",
    }),
  ],
  edges: [
    {
      source: "sessions/2026-09-01/capture_session_a",
      target: "projects/lev8",
    },
  ],
};

describe("graph neighborhood", () => {
  it("centers the title match and includes an edge the node does not list", () => {
    const neighborhood = graphNeighborhood(graph, "lev8");
    expect(neighborhood?.center.title).toBe("Lev8 Outbound");
    expect(neighborhood?.mentionedBy.map((node) => node.title)).toEqual([
      "Kickoff meeting",
    ]);
    expect(neighborhood?.also.map((node) => node.title)).toEqual(["Method"]);
    const kickoff = graphNeighborhood(graph, "Kickoff");
    expect(kickoff?.links.map((node) => node.title)).toEqual(["Lev8 Outbound"]);
  });

  it("is empty when the search matches nothing", () => {
    expect(graphNeighborhood(graph, "   ")).toBeUndefined();
    expect(graphNeighborhood(graph, "missing")).toBeUndefined();
  });
});
