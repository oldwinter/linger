import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PersonalKnowledgeQueryRequest,
  PersonalKnowledgeQueryResponse,
} from "@linger/wire-contracts/node-services-internal/client";

import {
  formatMemorySearch,
  parseMemorySearchArguments,
  runMemorySearchCli,
} from "../../src/memory/search-cli.js";
import { contextHostRoot } from "../../src/paths.js";
import type { AnotherMeSubject } from "../../src/memory/types.js";

const subject: AnotherMeSubject = {
  agentActorId: "actor_agent",
  agentDisplayName: "Another Me",
  agentManagementId: "agent_1",
  memorySubjectKey: "agent_1",
  representedHumanAccountId: null,
  representedHumanActorId: "actor_human",
  representedHumanDisplayName: "Bo",
  tenantId: "tenant_1",
};

const otherSubject: AnotherMeSubject = {
  ...subject,
  agentActorId: "actor_agent_2",
  agentManagementId: "agent_2",
  memorySubjectKey: "agent_2",
};

type SearchEntry = PersonalKnowledgeQueryResponse["items"][number];

function entry(input: {
  citeAs: string;
  kind: SearchEntry["kind"];
  text?: string;
  title: string;
}): SearchEntry {
  return {
    citeAs: input.citeAs,
    evidenceId: "raw_0123456789abcdef_fedcba9876543210",
    kind: input.kind,
    sections: [],
    title: input.title,
    ...(input.text ? { snippet: input.text } : {}),
  };
}

function response(
  overrides: Partial<PersonalKnowledgeQueryResponse> = {},
): PersonalKnowledgeQueryResponse {
  return {
    gaps: [],
    indexedAt: null,
    items: [],
    page: 1,
    schemaVersion: 2,
    status: "grounded",
    summaries: [],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("parseMemorySearchArguments", () => {
  it("joins the words into the query and resolves the Memory root", () => {
    const args = parseMemorySearchArguments(["--", "cobalt", "budget"]);
    expect(args).toEqual({
      options: expect.objectContaining({ memoryRoot: contextHostRoot() }),
      query: "cobalt budget",
    });
  });

  it("takes the subject, scope and Memory root options", () => {
    const args = parseMemorySearchArguments([
      "cobalt",
      "--memory-subject-key",
      "agent_1",
      "--scope",
      "summaries",
      "--memory-root",
      "/tmp/memory",
    ]);
    expect(args.query).toBe("cobalt");
    expect(args.scope).toBe("summaries");
    expect(args.options.memorySubjectKey).toBe("agent_1");
    expect(args.options.memoryRoot).toBe("/tmp/memory");
  });

  it("rejects a missing query, an unknown scope and an unknown option", () => {
    expect(() => parseMemorySearchArguments(["--scope", "summaries"])).toThrow(
      /Usage: memory:search/,
    );
    expect(() =>
      parseMemorySearchArguments(["--scope", "everything", "cobalt"]),
    ).toThrow(/--scope must be originals or summaries/);
    expect(() =>
      parseMemorySearchArguments(["cobalt", "--unknown", "value"]),
    ).toThrow(/Unknown or incomplete option: --unknown/);
  });
});

describe("formatMemorySearch", () => {
  it("says so when nothing matched", () => {
    expect(formatMemorySearch(response({ status: "empty" }), "cobalt")).toEqual(
      ['No hits for "cobalt".'],
    );
  });

  it("prints one line per hit with its rank, scope, title or ID and text", () => {
    const fact = {
      evidenceId: "raw_0123456789abcdef_fedcba9876543210",
      factType: "world" as const,
      mentionedAt: "2026-09-03T00:00:00Z",
      sectionId: "section-1",
      text: "Cobalt launch moved to October",
    };
    expect(
      formatMemorySearch(
        response({
          facts: [fact],
          items: [
            entry({
              citeAs: "S1",
              kind: "room",
              text: "Cobalt budget\napproved at 120k.",
              title: "Re: Cobalt budget",
            }),
          ],
          summaries: [
            entry({ citeAs: "W1", kind: "wiki", title: "Projects/Cobalt" }),
          ],
        }),
        "cobalt",
      ),
    ).toEqual([
      '3 hits for "cobalt" (grounded)',
      "S1  original:room  Re: Cobalt budget  —  Cobalt budget approved at 120k.",
      "W1  summary:wiki  Projects/Cobalt",
      "F1  fact  raw_0123456789abcdef_fedcba9876543210  —  Cobalt launch moved to October",
    ]);
  });

  it("keeps a hit's text to one short line", () => {
    const [, line] = formatMemorySearch(
      response({
        items: [
          entry({
            citeAs: "S1",
            kind: "mail",
            text: "a".repeat(400),
            title: "Cobalt thread",
          }),
        ],
      }),
      "cobalt",
    );
    expect(line).toContain(`${"a".repeat(140)}…`);
    expect(line).not.toContain("a".repeat(141));
  });
});

describe("runMemorySearchCli", () => {
  it("queries for the subject and prints the formatted result", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const query = vi.fn(
      async (_dataRoot: string, _input: PersonalKnowledgeQueryRequest) =>
        response({
          items: [
            entry({ citeAs: "S1", kind: "room", title: "Re: Cobalt budget" }),
          ],
          status: "partial",
        }),
    );
    const args = parseMemorySearchArguments(["cobalt", "--scope", "originals"]);

    const result = await runMemorySearchCli(args, {
      query,
      subjects: [subject],
    });

    expect(result.status).toBe("partial");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]!.slice(0, 2)).toEqual([
      contextHostRoot(),
      {
        agent_actor_id: "actor_agent",
        agent_id: "agent_1",
        query: "cobalt",
        scope: "originals",
        tenant_id: "tenant_1",
        user_artifact_owner_actor_id: "actor_human",
      },
    ]);
    expect(output.mock.calls.map((call) => call[0])).toEqual([
      '1 hit for "cobalt" (partial)',
      "S1  original:room  Re: Cobalt budget",
    ]);
  });

  it("selects the subject by key and refuses an ambiguous or missing one", async () => {
    const query = vi.fn(
      async (_dataRoot: string, _input: PersonalKnowledgeQueryRequest) =>
        response(),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runMemorySearchCli(
      parseMemorySearchArguments(["cobalt", "--memory-subject-key", "agent_2"]),
      { query, subjects: [subject, otherSubject] },
    );
    expect(query.mock.calls[0]![1].agent_actor_id).toBe("actor_agent_2");

    await expect(
      runMemorySearchCli(parseMemorySearchArguments(["cobalt"]), {
        query,
        subjects: [subject, otherSubject],
      }),
    ).rejects.toThrow(
      /Several AnotherMe subjects match; pass --memory-subject-key: agent_1, agent_2/,
    );
    await expect(
      runMemorySearchCli(
        parseMemorySearchArguments([
          "cobalt",
          "--memory-subject-key",
          "missing",
        ]),
        { query, subjects: [subject] },
      ),
    ).rejects.toThrow(/No AnotherMe subject missing/);
    expect(query).toHaveBeenCalledOnce();
  });
});
