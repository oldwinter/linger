import { describe, expect, it } from "vitest";

import {
  WIKI_PAGE_EXCERPT_LIMIT,
  wikiPageExcerpt,
  wikiPageShare,
  wikiPageShareIdempotencyKey,
} from "./wiki-page-share";

const url = "https://linger.example/t/tenant-northstar/documents/document-wiki";

describe("wikiPageExcerpt", () => {
  it("returns a short page whole, as one plain-text paragraph", () => {
    expect(
      wikiPageExcerpt("# Casey example\n\nA **short** page with [a link](x)."),
    ).toBe("Casey example A short page with a link.");
  });

  it("cuts a long page at a word boundary and says it continues", () => {
    const text = Array.from({ length: 70 }, (_, index) => `word${index}`).join(
      " ",
    );
    const excerpt = wikiPageExcerpt(text);

    expect(excerpt).toBe(
      `${text.slice(0, text.lastIndexOf(" ", WIKI_PAGE_EXCERPT_LIMIT - 1))}…`,
    );
    expect(excerpt.endsWith(" …")).toBe(false);
    expect(excerpt.length).toBeLessThanOrEqual(WIKI_PAGE_EXCERPT_LIMIT + 1);
  });

  it("never splits a surrogate pair when the page has no word boundary", () => {
    const excerpt = wikiPageExcerpt("😀".repeat(300));

    expect(Array.from(excerpt)).toHaveLength(WIKI_PAGE_EXCERPT_LIMIT + 1);
    expect(
      Array.from(excerpt).every(
        (character) => character === "😀" || character === "…",
      ),
    ).toBe(true);
  });

  it("has nothing to excerpt for an empty or whitespace-only page", () => {
    expect(wikiPageExcerpt("")).toBe("");
    expect(wikiPageExcerpt("# \n\n   \n")).toBe("");
  });
});

describe("wikiPageShare", () => {
  it("writes the title, the excerpt, and the absolute link", () => {
    expect(
      wikiPageShare({
        documentId: "document-wiki",
        markdown: "# Intro\n\nThe page opens here.",
        title: "Casey example",
        updatedAt: "2026-11-15T09:00:00Z",
        url,
      }).text,
    ).toBe(["# Casey example", "Intro The page opens here.", url].join("\n\n"));
  });

  it("leaves the excerpt out of an empty page without leaving a gap", () => {
    expect(
      wikiPageShare({
        documentId: "document-wiki",
        markdown: "",
        title: "Casey example",
        updatedAt: "2026-11-15T09:00:00Z",
        url,
      }).text,
    ).toBe(["# Casey example", url].join("\n\n"));
  });

  it("changes its version with the page's updated time", () => {
    const share = (updatedAt: string) =>
      wikiPageShare({
        documentId: "document-wiki",
        markdown: "",
        title: "Casey example",
        updatedAt,
        url,
      }).version;

    expect(share("2026-11-15T09:00:00Z")).toBe(
      "document-wiki:2026-11-15T09:00:00Z",
    );
    expect(share("2026-11-15T09:00:00Z")).not.toBe(
      share("2026-11-15T10:00:00Z"),
    );
  });
});

describe("wikiPageShareIdempotencyKey", () => {
  it("keeps one key per page revision and Room", () => {
    expect(
      wikiPageShareIdempotencyKey(
        "document-wiki:2026-11-15T09:00:00Z",
        "room-all",
      ),
    ).toBe("wiki-page-share:document-wiki:2026-11-15T09:00:00Z:room-all");
    expect(
      wikiPageShareIdempotencyKey(
        "document-wiki:2026-11-15T09:00:00Z",
        "room-all",
      ),
    ).toBe(
      wikiPageShareIdempotencyKey(
        "document-wiki:2026-11-15T09:00:00Z",
        "room-all",
      ),
    );
  });

  it("gives another Room and another revision their own keys", () => {
    expect(
      wikiPageShareIdempotencyKey(
        "document-wiki:2026-11-15T09:00:00Z",
        "room-all",
      ),
    ).not.toBe(
      wikiPageShareIdempotencyKey(
        "document-wiki:2026-11-15T09:00:00Z",
        "room-product-v0",
      ),
    );
    expect(
      wikiPageShareIdempotencyKey(
        "document-wiki:2026-11-15T09:00:00Z",
        "room-all",
      ),
    ).not.toBe(
      wikiPageShareIdempotencyKey(
        "document-wiki:2026-11-15T10:00:00Z",
        "room-all",
      ),
    );
  });
});
