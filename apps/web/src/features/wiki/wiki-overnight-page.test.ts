import { describe, expect, it } from "vitest";

import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

import { wikiDocument } from "./wiki.test-support";
import { overnightWikiPage } from "./wiki-overnight-page";

const now = new Date(2026, 10, 16, 8, 55);
const yesterday = new Date(2026, 10, 15, 23, 10).toISOString();

function page(id: string, updatedAt: string): TeamHubDocument {
  const document = wikiDocument(id, `${id}.md`, "wiki_page");
  document.updated_at = updatedAt;
  document.from[0]!.page_key = `topics/${id}.md`;
  return document;
}

describe("overnightWikiPage", () => {
  it("waits with the page Another Me finished yesterday until it is opened", () => {
    const finished = page("launch", yesterday);
    const older = page("older", new Date(2026, 10, 15, 18, 0).toISOString());
    const today = page("today", new Date(2026, 10, 16, 7, 0).toISOString());
    const human = page("mine", yesterday);
    human.creator = { ...human.creator, kind: "human", id: "actor-human" };
    expect(
      overnightWikiPage([today, older, human, finished], [], now)?.id,
    ).toBe("launch");
    expect(
      overnightWikiPage(
        [finished],
        [
          {
            id: "launch",
            openedAt: new Date(2026, 10, 16, 9, 0).toISOString(),
          },
        ],
        now,
      ),
    ).toBeUndefined();
  });
});
