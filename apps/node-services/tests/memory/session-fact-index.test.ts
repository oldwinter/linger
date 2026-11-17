import { createJsonLogger } from "@linger/service-kit/node";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { ModelCallError } from "../../src/runtime-model-call.js";
import {
  memoryLogger,
  setMemoryLogger,
} from "../../src/memory/run-telemetry.js";
import type { extractWindowBatch } from "../../src/memory/session-fact-extraction.js";
import {
  factChunk,
  factContext,
  messageAt,
  sessionFactText,
  SessionFactIndex,
} from "../../src/memory/session-fact-index.js";

function syncHarness() {
  const sql = vi.fn().mockResolvedValue([]);
  Object.assign(sql, {
    begin: (work: (transaction: typeof sql) => Promise<void>) => work(sql),
  });
  const extract = vi
    .fn<typeof extractWindowBatch>()
    .mockImplementation(
      async (batch) => new Map(batch.map(({ window }) => [window.sha256, []])),
    );
  const index = new SessionFactIndex({
    sql: sql as unknown as postgres.Sql,
    extract,
  });
  function sync(agentId: string, contents = ["A private source sentence."]) {
    sql.mockResolvedValueOnce(
      contents.map((content, ordinal) => ({
        id: `${agentId}_${ordinal}`,
        tenant_id: "tenant_a",
        owner_id: "owner_a",
        agent_id: agentId,
        active_sha256: "a".repeat(64),
        content,
        date: "2026-09-29",
        origin_kind: "pocket_note",
        mail_class: null,
        replied: false,
      })),
    );
    return index.syncAgent(agentId);
  }
  return { index, extract, sql, sync };
}

describe("Session fact failure diagnostics", () => {
  it("reports partial extraction and clears a failure only after that Agent succeeds", async () => {
    const { index, extract, sync } = syncHarness();
    expect(index.failures()).toEqual({
      scope: "process",
      observed_since: expect.any(String),
      total: 0,
      items: [],
    });
    extract.mockResolvedValueOnce(new Map());
    await sync("agent_a");
    await sync("agent_b");
    expect(index.failures()).toMatchObject({
      total: 1,
      items: [
        {
          agent_id: "agent_a",
          failed_windows: 1,
          last_error_kind: "invalid_output",
        },
      ],
    });
    extract.mockImplementationOnce(
      async (batch) => new Map([[batch[0]!.window.sha256, []]]),
    );
    expect(
      await sync("agent_a", [
        "First private source.",
        "Second private source.",
      ]),
    ).toMatchObject({ extracted: 1, failed: 1 });
    expect(index.failures().total).toBe(1);
    await sync("agent_a");
    expect(index.failures()).toMatchObject({ total: 0, items: [] });
  });

  it.each(["invalid_output", "computer_offline", "failed"] as const)(
    "preserves the structured %s kind and owner in serialized logs",
    async (kind) => {
      const { index, extract, sync } = syncHarness();
      const lines: string[] = [];
      const previous = memoryLogger();
      setMemoryLogger(
        createJsonLogger({
          service: "test",
          write: (line) => lines.push(line),
        }),
      );
      try {
        extract.mockRejectedValueOnce(
          new ModelCallError(kind, "Model call failed", {
            output: "private model output",
          }),
        );
        expect(await sync("agent_a")).toMatchObject({ failed: 1 });
        expect(lines.map((line) => JSON.parse(line))).toMatchObject([
          {
            event: "memory.session_fact_extraction_failed",
            error: { name: "ModelCallError", message: "Model call failed" },
            error_kind: kind,
            agent_id: "agent_a",
            tenant_id: "tenant_a",
            owner_id: "owner_a",
            windows: 1,
          },
        ]);
        expect(index.failures()).toMatchObject({
          total: 1,
          items: [
            {
              agent_id: "agent_a",
              failed_windows: 1,
              last_failure_at: expect.any(String),
              last_error_kind: kind,
            },
          ],
        });
        expect(
          JSON.stringify(index.failures()) + lines.join("\n"),
        ).not.toContain("private");
      } finally {
        setMemoryLogger(previous);
      }
    },
  );

  it("keeps aborted syncs visible without inventing a count or inferring kinds from prose", async () => {
    const { index, sql, sync } = syncHarness();
    const error = new Error("The owner's Local Computer is offline");
    sql.mockRejectedValueOnce(error);
    await expect(index.syncAgent("agent_a")).rejects.toBe(error);
    sql.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(index.syncAgent("agent_b")).rejects.toThrow(
      "Database unavailable",
    );
    expect(index.failures(1)).toMatchObject({
      total: 2,
      items: [
        {
          agent_id: "agent_a",
          failed_windows: null,
          last_error_kind: "unknown",
        },
      ],
    });
    expect(index.failures(1).items).toHaveLength(1);
    await sync("agent_a");
    expect(index.failures().items.map((item) => item.agent_id)).toEqual([
      "agent_b",
    ]);
    expect(syncHarness().index.failures()).toMatchObject({
      total: 0,
      items: [],
    });
  });
});

describe("Session fact binding", () => {
  it("takes the mention time and speaker from the enclosing Room message", () => {
    const content = [
      "## 2026-09-29T01:00:00.000Z · Ann",
      "",
      "Morning.",
      "",
      "## 2026-09-29T07:00:00.000Z · Bob",
      "",
      "Max turned three today.",
    ].join("\n");
    expect(messageAt(content, content.indexOf("Max turned"))).toEqual({
      mentionedAt: "2026-09-29T07:00:00.000Z",
      speaker: "Bob",
    });
    expect(
      messageAt("Recording transcript without headings", 5),
    ).toBeUndefined();
  });
});

describe("Session fact context", () => {
  it("tells the extraction what kind of text each origin is", () => {
    const at = { date: "2026-09-29", mail_class: null, replied: false };
    expect(factContext({ ...at, origin_kind: "room" })).toBe(
      "Conversation session on 2026-09-29",
    );
    expect(factContext({ ...at, origin_kind: "recording" })).toMatch(
      /^Meeting recording transcript on 2026-09-29.*Speakers may be unlabeled/u,
    );
    expect(factContext({ ...at, origin_kind: "pocket_note" })).toBe(
      "The user's own Pocket Note on 2026-09-29.",
    );
    const mail = { ...at, origin_kind: "mail" };
    expect(factContext({ ...mail, mail_class: "direct_inbound" })).toMatch(
      /^Email on 2026-09-29.*Attribute each fact/u,
    );
    // A notification may hold nothing worth keeping, unless the Human replied.
    expect(factContext({ ...mail, mail_class: "system_notification" })).toMatch(
      /^Automated email.*return none\.$/u,
    );
    expect(
      factContext({
        ...mail,
        mail_class: "system_notification",
        replied: true,
      }),
    ).toMatch(/^Email on/u);
  });
});

describe("Session fact chunk", () => {
  it("binds a fact to the window chunk sharing the most terms", () => {
    const chunk = (id: string, content: string) => ({
      id,
      content,
      start: 0,
      end: content.length,
      heading: "",
      headingPath: [],
      lineStart: 1,
      lineEnd: 1,
      level: 2,
    });
    const chunks = [
      chunk("a", "We talked about packing for the trip."),
      chunk("b", "Max the Golden Retriever turned three."),
    ];
    expect(
      factChunk(
        { what: "Max is a Golden Retriever", entities: ["Max"] },
        chunks as never,
      ).id,
    ).toBe("b");
  });
});

describe("Session fact text", () => {
  it("joins what, when, who and why as Hindsight stores them, skipping N/A", () => {
    expect(
      sessionFactText({
        what: "User started cello lessons",
        when: "February 2024",
        where: "Home",
        who: "user",
        why: "N/A",
        fact_type: "world",
      }),
    ).toBe(
      "User started cello lessons | When: February 2024 | Involving: user",
    );
    expect(
      sessionFactText({
        what: "Mia opened a bakery",
        when: "n/a",
        who: "Mia (user's sister)",
        why: "She wanted her own shop",
        fact_type: "world",
      }),
    ).toBe(
      "Mia opened a bakery | Involving: Mia (user's sister) | She wanted her own shop",
    );
  });
});

describe("temporal window coverage", () => {
  it("spreads entry points across the window instead of one busy day", async () => {
    const { selectWithTemporalCoverage } =
      await import("../../src/memory/search/temporal-window.js");
    const busy = Array.from({ length: 20 }, (_, i) => ({
      id: `busy-${i}`,
      date: "2026-04-02",
    }));
    const late = { id: "late", date: "2026-04-28" };
    const selected = selectWithTemporalCoverage(
      [...busy, late],
      (row) => row.date,
      {
        from: "2026-04-01",
        to: "2026-04-30",
      },
    );
    expect(selected).toHaveLength(10);
    expect(selected.map((row) => row.id)).toContain("late");
    // Similarity order (input order) is kept among the selected rows.
    expect(selected.at(-1)!.id).toBe("late");
  });

  it("nudges the fused order toward records near the as-of day", async () => {
    const { boostByRecency, recencyOnOrBefore } =
      await import("../../src/memory/search/temporal-window.js");
    expect(recencyOnOrBefore("2026-11-13", "2026-11-13")).toBe(1);
    expect(recencyOnOrBefore("2026-10-14", "2026-11-13")).toBe(0.5);
    expect(recencyOnOrBefore("2026-08-01", "2026-11-13")).toBe(0.1);
    // Not yet said on the day: the floor. Undated: neutral.
    expect(recencyOnOrBefore("2026-11-14", "2026-11-13")).toBe(0.1);
    expect(recencyOnOrBefore(undefined, "2026-11-13")).toBe(0.5);
    // Best-ranked first: a year-old best match, a fresh second, then filler.
    const rows = [
      { id: "old", date: "2025-11-01" },
      { id: "fresh", date: "2026-11-10" },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `filler${i}`,
        date: "2025-06-01",
      })),
      { id: "fresh-weak", date: "2026-11-13" },
    ];
    const order = (asOf: string) =>
      boostByRecency(rows, (row) => row.date, asOf).map((row) => row.id);
    expect(order("2026-11-13").slice(0, 2)).toEqual(["fresh", "old"]);
    // A fresh but weak match stays near the end.
    expect(order("2026-11-13").indexOf("fresh-weak")).toBeGreaterThan(5);
    // Before the fresh record existed, the relevance order stands.
    expect(order("2025-11-02").slice(0, 2)).toEqual(["old", "fresh"]);
  });
});
