import { describe, expect, it, vi } from "vitest";
import { createMemoryProjection } from "../../../../src/agent/agent-features/agent-memory/projection.js";
import type { MemoryDocument } from "../../../../src/agent/agent-features/agent-memory/client.js";

const sessionKey = "a".repeat(64);

function documentWith(memory: string): MemoryDocument {
  return {
    revision: 1,
    summary: "index",
    memory,
    sessions: {
      [sessionKey]: {
        context_key: "source",
        thread_id: "thread",
        through: 1,
        updated_revision: 1,
        summary: "source evidence",
        raw_memory: "unpublished candidate",
      },
    },
    cursors: {},
  };
}

describe("Agent memory projection", () => {
  it("says and projects nothing before the first publication", async () => {
    const projection = createMemoryProjection({
      read: async () => ({
        revision: 0,
        summary: "",
        memory: "",
        sessions: {},
        cursors: {},
      }),
      commit: vi.fn(),
    });
    await expect(
      projection.prepare("A", new AbortController().signal),
    ).resolves.toEqual({});
  });

  it("pins only published content without mutating the authoritative document", async () => {
    let document = documentWith("first decision");
    const commit = vi.fn();
    const projection = createMemoryProjection({
      read: async () => document,
      commit,
    });
    const signal = new AbortController().signal;
    const first = await projection.prepare("A", signal);
    document = { ...documentWith("second decision"), summary: "new index" };
    const second = await projection.prepare("A", signal);

    expect(first).toEqual({
      summary: "index",
      mapping: {
        kind: "memory",
        targetPath: "/workspace/agent-memory",
        access: "read_only",
        inlineFiles: {
          "summary.md": "index",
          "MEMORY.md": "first decision",
          [`session_summaries/${sessionKey}.md`]: "source evidence",
        },
      },
    });
    expect(Object.isFrozen(first.mapping!.inlineFiles)).toBe(true);
    expect(second).toMatchObject({
      summary: "new index",
      mapping: {
        inlineFiles: {
          "summary.md": "new index",
          "MEMORY.md": "second decision",
        },
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("refuses a session key that cannot name a file in the projection", async () => {
    const document = documentWith("decision");
    const projection = createMemoryProjection({
      read: async () => ({
        ...document,
        sessions: { "../outside": document.sessions[sessionKey]! },
      }),
      commit: vi.fn(),
    });
    await expect(
      projection.prepare("A", new AbortController().signal),
    ).rejects.toThrow("Invalid memory session key");
  });
});
