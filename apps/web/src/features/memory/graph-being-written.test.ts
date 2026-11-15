import { describe, expect, it } from "vitest";

import type { WikiPreviewPage } from "@/features/wiki/wiki-preview-pages";

import { graphWithPagesBeingWritten } from "./graph-being-written";
import { nodeMoments, type WikiGraphData } from "./wiki-graph-model";

const graph: WikiGraphData = {
  edges: [],
  nodes: [
    {
      backlinks: [],
      body: "",
      category: "projects",
      description: "",
      id: "projects/atlas",
      links: [],
      size: 1,
      tags: [],
      title: "Atlas",
    },
  ],
  types: [],
};

function page(path: string, name: string, markdown = ""): WikiPreviewPage {
  return {
    collection: "projects",
    description: "",
    key: path,
    markdown,
    name,
    path,
  };
}

describe("graphWithPagesBeingWritten", () => {
  it("lands a new session on its day and links the page it names", () => {
    const result = graphWithPagesBeingWritten(graph, [
      page(
        "sessions/2026-11-15/kickoff.md",
        "Kickoff",
        "We shipped [[Atlas]] from projects/atlas.",
      ),
      page("projects/other.md", "Other"),
    ]);
    expect(result.arrived).toEqual([
      {
        day: "2026-11-15",
        links: ["projects/atlas"],
        name: "Kickoff",
      },
      { links: [], name: "Other" },
    ]);
    expect(
      nodeMoments(result.graph).get("sessions/2026-11-15/kickoff.md"),
    ).toEqual([{ day: "2026-11-15", strength: "session" }]);
    expect(result.graph.edges).toEqual([
      {
        source: "sessions/2026-11-15/kickoff.md",
        target: "projects/atlas",
      },
    ]);
    expect(
      result.graph.nodes.find((node) => node.id === "projects/atlas")
        ?.backlinks,
    ).toEqual(["sessions/2026-11-15/kickoff.md"]);
  });

  it("leaves a session the graph already has", () => {
    const published: WikiGraphData = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          backlinks: [],
          body: "",
          category: "sessions",
          description: "",
          id: "sessions/2026-11-15/kickoff.md",
          links: [],
          size: 1,
          tags: [],
          title: "Kickoff",
        },
      ],
    };
    const result = graphWithPagesBeingWritten(published, [
      page("sessions/2026-11-15/kickoff.md", "Kickoff"),
    ]);
    expect(result.arrived).toEqual([]);
    expect(result.graph.nodes).toHaveLength(published.nodes.length);
  });
});
