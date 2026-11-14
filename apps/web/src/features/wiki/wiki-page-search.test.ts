import { describe, expect, it } from "vitest";

import {
  matchWikiPage,
  WIKI_SEARCH_BODY_LIMIT,
  wikiSearchText,
} from "./wiki-page-search";

describe("Wiki page search", () => {
  it("strips Markdown down to the words a reader sees", () => {
    const text = wikiSearchText(
      [
        "---",
        '{"type":"Project","title":"Atlas"}',
        "---",
        "# Heading",
        "",
        "> A quote with **bold** and _emphasis_ and `code`.",
        "",
        "- first item",
        "1. second item",
        "| kind | value |",
        "[link text](https://example.test) ![alt text](image.png)",
      ].join("\n"),
    );
    expect(text).toContain("Heading");
    expect(text).toContain("A quote with bold and _emphasis_ and code.");
    expect(text).toContain("first item");
    expect(text).toContain("second item");
    expect(text).toContain("kind value");
    expect(text).toContain("link text alt text");
    expect(text).not.toContain("#");
    expect(text).not.toContain("**");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("type");
  });

  it("matches case-insensitively and returns the body snippet", () => {
    const body = wikiSearchText("The quarterly Launch Plan is ready.");
    expect(
      matchWikiPage({ body, description: "", title: "Atlas" }, "launch PLAN"),
    ).toEqual({ snippet: "The quarterly Launch Plan is ready." });
  });

  it("keeps a name or description match stronger than the body", () => {
    const match = matchWikiPage(
      { body: "budget", description: "", title: "Budget review" },
      "budget",
    );
    expect(match).toEqual({});
    expect(match).not.toHaveProperty("snippet");
  });

  it("bounds the snippet around the first body match", () => {
    const body = `${"start ".repeat(40)}needle ${"tail ".repeat(40)}`;
    const snippet = matchWikiPage(
      { body, description: "", title: "Page" },
      "needle",
    )?.snippet;
    expect(snippet).toBeDefined();
    expect(snippet!.length).toBeLessThanOrEqual(60 + "needle".length + 60 + 2);
    expect(snippet!.startsWith("…")).toBe(true);
    expect(snippet!.endsWith("…")).toBe(true);
    expect(snippet).toContain("needle");
  });

  it("reports no match for absent text or an empty query", () => {
    expect(
      matchWikiPage(
        { body: "nothing here", description: "", title: "Page" },
        "absent",
      ),
    ).toBeUndefined();
    expect(
      matchWikiPage(
        { body: "anything", description: "", title: "Page" },
        "   ",
      ),
    ).toBeUndefined();
  });

  it("does not scan a body beyond the search limit", () => {
    const markdown = `${"x".repeat(WIKI_SEARCH_BODY_LIMIT)}beyond`;
    const body = wikiSearchText(markdown);
    expect(body).not.toContain("beyond");
    expect(
      matchWikiPage({ body, description: "", title: "Page" }, "beyond"),
    ).toBeUndefined();
  });
});
