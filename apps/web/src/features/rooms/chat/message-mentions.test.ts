import { describe, expect, it } from "vitest";

import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";

import { findDocumentCandidates } from "./message-composer-references";
import {
  activeMessageMentions,
  findMessageMentionQuery,
  omitDepartedMentions,
} from "./message-mentions";

const codex: TeamHubActorRef = {
  display_name: "Codex",
  id: "actor-codex",
  kind: "agent",
  tenant_id: "tenant-1",
};
const claude: TeamHubActorRef = {
  display_name: "Claude Code",
  id: "actor-claude",
  kind: "agent",
  tenant_id: "tenant-1",
};

describe("activeMessageMentions", () => {
  it("matches exact structured tokens while preserving trailing punctuation", () => {
    expect(
      activeMessageMentions("Ask @Codex, then confirm with @Claude Code.", [
        codex,
        claude,
      ]),
    ).toEqual([codex, claude]);
  });

  it("does not infer one Actor from a longer plain-text token", () => {
    expect(activeMessageMentions("Ask @CodexExtra", [codex])).toEqual([]);
    expect(activeMessageMentions("Ask @Claude Codebase", [claude])).toEqual([]);
  });

  it("orders active Actors by their first occurrence in the final body", () => {
    expect(
      activeMessageMentions("Ask @Claude Code before @Codex", [codex, claude]),
    ).toEqual([claude, codex]);
  });
});

describe("omitDepartedMentions", () => {
  const room = new Set([codex.id, claude.id]);

  it("lifts a departed name out of the unsent sentence", () => {
    expect(
      omitDepartedMentions(
        "Ask @Codex to look",
        [codex, claude],
        new Set([claude.id]),
        8,
      ),
    ).toEqual({
      body: "Ask to look",
      caret: 4,
      mentions: [claude],
    });
    expect(
      omitDepartedMentions("@Claude Code, please", [claude], new Set()),
    ).toEqual({
      body: ", please",
      caret: ", please".length,
      mentions: [],
    });
    expect(
      omitDepartedMentions("Ask @Codex to look", [codex], room),
    ).toMatchObject({ body: "Ask @Codex to look", mentions: [codex] });
  });
});

describe("findMessageMentionQuery", () => {
  it("starts a mention straight after an unspaced-script character", () => {
    const japanese = "\u8cc7\u6599\u3092\u78ba\u8a8d@\u5c71\u7530";
    expect(findMessageMentionQuery(japanese, japanese.length)).toEqual({
      end: japanese.length,
      query: "\u5c71\u7530",
      start: japanese.length - 3,
    });
    const chinese = "\u4f60\u597d@\u5f20\u4e09";
    expect(findMessageMentionQuery(chinese, chinese.length)).toEqual({
      end: chinese.length,
      query: "\u5f20\u4e09",
      start: 2,
    });
  });

  it("stays closed where the token matcher would refuse the mention", () => {
    // The message builder refuses a token after a slash or a second at-sign,
    // so the picker must not offer a person for those bodies either.
    for (const body of ["a/@", "x@@", "\u4f60\u597d/@"])
      expect(findMessageMentionQuery(body, body.length)).toBeNull();
  });

  it("keeps a Latin word's at-sign literal", () => {
    for (const body of ["alice@example", "user_1@", "2026@"])
      expect(findMessageMentionQuery(body, body.length)).toBeNull();
  });

  it("keeps spaced scripts and pasted combining marks literal", () => {
    // These scripts separate words with spaces, so `word@` is an address or a
    // handle there; an NFD vowel sign is part of the word before the at-sign.
    for (const body of [
      "\u0438\u0432\u0430\u043d@",
      "\u03b1\u03b2@",
      "\u0627\u0644\u064a@",
      "\u05e9\u05dc\u05d5\u05dd@",
      "cafe\u0301@",
    ])
      expect(findMessageMentionQuery(body, body.length)).toBeNull();
  });

  it("reads a CJK query after @ so unspaced Document titles are searchable", () => {
    const body = "みて @あい";
    const query = findMessageMentionQuery(body, body.length);
    expect(query).toEqual({ end: body.length, query: "あい", start: 3 });
    const candidates = findDocumentCandidates(query, [
      { documentId: "doc-cn", name: "あいうえお.md", updatedAt: "" },
      { documentId: "doc-en", name: "project-brief.md", updatedAt: "" },
    ]);
    expect(candidates.map((document) => document.documentId)).toEqual([
      "doc-cn",
    ]);
  });
});

describe("the Skill picker shares the mention boundary", () => {
  it("opens after an unspaced script and stays closed after a word", async () => {
    const { findMessageSkillQuery } =
      await import("./message-composer-references");
    const mentions = [{ kind: "agent", display_name: "Linger" }] as never;
    // The picker needs a Mentioned Agent before the slash, as it always has.
    const unspaced = "@Linger \u8cc7\u6599/";
    expect(
      findMessageSkillQuery(unspaced, unspaced.length, mentions),
    ).toMatchObject({ query: "" });
    for (const body of ["@Linger a/", "@Linger x//", "@Linger alice/"])
      expect(findMessageSkillQuery(body, body.length, mentions)).toBeNull();
  });
});

describe("the boundary covers the scripts that write without spaces", () => {
  it("opens after a prolonged sound mark and a decomposed voiced mark", () => {
    for (const body of [
      "\u30e1\u30f3\u30d0\u30fc@", // member + U+30FC
      "\u30ab\u3099@", // ka + combining voiced mark
      "\u3005@", // iteration mark, Script=Han but not Ideographic
    ])
      expect(findMessageMentionQuery(body, body.length)).not.toBeNull();
  });

  it("opens after punctuation, as the token matcher does", () => {
    for (const body of ["(@", "\u3001@"])
      expect(findMessageMentionQuery(body, body.length)).not.toBeNull();
  });
});

describe("a token after an astral character", () => {
  it("reads the whole character, not half of it", () => {
    // U+20BB7 is Ideographic, so a mention starts after it.
    const ideograph = "\u{20BB7}@";
    expect(findMessageMentionQuery(ideograph, ideograph.length)).not.toBeNull();
    // U+1D400 is a Latin mathematical letter, so the at-sign stays literal.
    const mathBold = "\u{1D400}@";
    expect(findMessageMentionQuery(mathBold, mathBold.length)).toBeNull();
  });
});
