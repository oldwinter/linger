import { expect, it } from "vitest";

import { wikiPageHrefs } from "./wiki-page-links";
import { wikiDocument } from "./wiki.test-support";

it("maps Wiki page keys to the Document route that opens each page", () => {
  const project = wikiDocument("project-one", "Project one.md", "wiki_page");
  project.from[0]!.page_key = "/projects/project-one.md";
  const index = wikiDocument("project-index", "index.md", "wiki_page");
  index.from[0]!.page_key = "projects/atlas/index.md";
  const source = wikiDocument("source-one", "brief.md", "wiki_source");

  expect([
    ...wikiPageHrefs("tenant/northstar", [project, index, source]),
  ]).toEqual([
    ["projects/project-one", "/t/tenant%2Fnorthstar/documents/project-one"],
    ["projects/atlas", "/t/tenant%2Fnorthstar/documents/project-index"],
  ]);
});
