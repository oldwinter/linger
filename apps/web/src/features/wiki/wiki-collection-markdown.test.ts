import { describe, expect, it } from "vitest";

import { wikiCollectionMarkdown } from "./wiki-collection-markdown";

const origin = "https://app.example";

describe("wikiCollectionMarkdown", () => {
  it("writes the heading and one linked entry for a single page", () => {
    expect(
      wikiCollectionMarkdown({
        label: "Projects",
        origin,
        pages: [
          {
            path: "/t/tenant-northstar/documents/document-alpha",
            title: "Alpha",
          },
        ],
      }),
    ).toBe(
      "# Projects\n- [Alpha](https://app.example/t/tenant-northstar/documents/document-alpha)",
    );
  });

  it("keeps the pages' displayed order", () => {
    expect(
      wikiCollectionMarkdown({
        label: "Topics",
        origin,
        pages: [
          { path: "/t/tenant-northstar/documents/second", title: "Second" },
          { path: "/t/tenant-northstar/documents/first", title: "First" },
        ],
      }),
    ).toBe(
      [
        "# Topics",
        "- [Second](https://app.example/t/tenant-northstar/documents/second)",
        "- [First](https://app.example/t/tenant-northstar/documents/first)",
      ].join("\n"),
    );
  });

  it("writes just the heading for an empty collection", () => {
    expect(wikiCollectionMarkdown({ label: "People", origin, pages: [] })).toBe(
      "# People",
    );
  });

  it("keeps a title with Markdown characters as plain link text", () => {
    expect(
      wikiCollectionMarkdown({
        label: "Projects",
        origin,
        pages: [
          {
            path: "/t/tenant one/documents/a b",
            title: "Q1 [draft] \\ final *",
          },
        ],
      }),
    ).toBe(
      "# Projects\n- [Q1 \\[draft\\] \\\\ final *](https://app.example/t/tenant%20one/documents/a%20b)",
    );
  });
});
