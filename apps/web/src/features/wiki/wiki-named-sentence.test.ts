import { describe, expect, it } from "vitest";

import type { WikiGraphData } from "@/features/memory/wiki-graph-model";

import { wikiNamedSentence } from "./wiki-named-sentence";

function graph(
  edges: WikiGraphData["edges"],
  nodes: WikiGraphData["nodes"],
): WikiGraphData {
  return { edges, nodes, types: [] };
}

const session = {
  backlinks: [],
  body: "",
  category: "Session",
  description: "",
  id: "sessions/2026-09-01/capture",
  links: [],
  size: 1,
  tags: [],
  title: "Monday",
};

describe("wikiNamedSentence", () => {
  it("ends the page with the one page it names and does not link", () => {
    expect(
      wikiNamedSentence(
        session.id,
        graph(
          [
            {
              kind: "mention",
              source: session.id,
              target: "contacts/ada",
            },
          ],
          [
            session,
            {
              ...session,
              description: "Keeps the release honest and small",
              id: "contacts/ada",
              title: "Ada",
            },
          ],
        ),
      ),
    ).toBe("Ada keeps the release honest and small.");
  });

  it("stays quiet when the page names several pages or already links", () => {
    const named = {
      ...session,
      description: "Keeps the release honest and small",
      id: "contacts/ada",
      title: "Ada",
    };
    expect(
      wikiNamedSentence(
        session.id,
        graph(
          [
            { kind: "mention", source: session.id, target: "contacts/ada" },
            { kind: "mention", source: session.id, target: "projects/lev8" },
          ],
          [session, named],
        ),
      ),
    ).toBeUndefined();
    expect(
      wikiNamedSentence(
        session.id,
        graph(
          [{ source: session.id, target: "contacts/ada" }],
          [session, named],
        ),
      ),
    ).toBeUndefined();
  });

  it("keeps a sentence that already says the name", () => {
    expect(
      wikiNamedSentence(
        session.id,
        graph(
          [{ kind: "mention", source: session.id, target: "contacts/ada" }],
          [
            session,
            {
              ...session,
              body: "# Ada\n\nAda keeps the release honest and small. More follows.",
              description: "",
              id: "contacts/ada",
              title: "Ada",
            },
          ],
        ),
      ),
    ).toBe("Ada keeps the release honest and small.");
  });
});
