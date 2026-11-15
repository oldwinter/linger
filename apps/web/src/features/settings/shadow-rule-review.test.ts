import { describe, expect, it } from "vitest";

import type { TeamHubProactiveRuleBook } from "@/features/teamhub/teamhub-types";

import {
  newestShadowDivergence,
  reviewResultCopy,
  shadowDivergenceLine,
  shadowRuleIds,
} from "./shadow-rule-review";

const book = {
  version: 2,
  rules: [
    {
      id: "pr_0000000000000000000000000000000a",
      text: "Client replies",
      status: "active",
      pinned: false,
      source: "learned",
      created_at: "2026-11-01T08:00:00Z",
      promoted_at: "2026-11-01T08:00:00Z",
      guideline_version: 2,
      mandate: "none",
    },
    {
      id: "pr_0000000000000000000000000000000b",
      text: "Vendor invoices",
      status: "shadow",
      pinned: false,
      source: "learned",
      created_at: "2026-11-02T08:00:00Z",
      promoted_at: null,
      guideline_version: 2,
      mandate: "none",
    },
    {
      id: "pr_0000000000000000000000000000000c",
      text: "Travel receipts",
      status: "shadow",
      pinned: false,
      source: "learned",
      created_at: "2026-11-03T08:00:00Z",
      promoted_at: null,
      guideline_version: 2,
      mandate: "none",
    },
  ],
  clues: [],
  divergences: [
    {
      id: "psd_0000000000000000000000000000000b",
      rule_id: "pr_0000000000000000000000000000000b",
      guideline_version: 2,
      matter: "AWS invoice",
      shadow_action: "track",
      taken_action: "notify",
      created_at: "2026-11-04T08:00:00Z",
    },
    {
      id: "psd_0000000000000000000000000000000a",
      rule_id: "pr_0000000000000000000000000000000b",
      guideline_version: 2,
      matter: "Older invoice",
      shadow_action: "silent",
      taken_action: "notify",
      created_at: "2026-11-01T08:00:00Z",
    },
  ],
  mandates: [],
} as TeamHubProactiveRuleBook;

describe("shadow rule review", () => {
  it("walks shadow rules in book order and keeps the newest difference", () => {
    expect(shadowRuleIds(book)).toEqual([
      "pr_0000000000000000000000000000000b",
      "pr_0000000000000000000000000000000c",
    ]);
    const newest = newestShadowDivergence(
      book,
      "pr_0000000000000000000000000000000b",
    );
    expect(newest?.matter).toBe("AWS invoice");
    expect(shadowDivergenceLine(newest!)).toBe(
      "AWS invoice: would follow up later, Another Me chose to tell now",
    );
    expect(
      newestShadowDivergence(book, "pr_0000000000000000000000000000000c"),
    ).toBeUndefined();
  });

  it("says what was promoted and what stays in shadow", () => {
    expect(reviewResultCopy(1, 1)).toBe(
      "You promoted 1 rule. 1 stays in shadow.",
    );
    expect(reviewResultCopy(2, 0)).toBe(
      "You promoted 2 rules. None stay in shadow.",
    );
    expect(reviewResultCopy(0, 2)).toBe("You left 2 rules in shadow.");
  });
});
