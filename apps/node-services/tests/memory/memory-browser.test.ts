import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  getMemoryEntry,
  listMemoryEntries,
} from "../../src/memory/memory-browser.js";

vi.mock("../../src/memory/collector.js", () => ({
  loadWikiGraphSubjectsForActor: async () => [
    { tenantId: "tenant_1", agentManagementId: "agent_alice" },
  ],
}));

it("lists and reads reports beside a file with malformed metadata", async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "memory-browser-"));
  try {
    const daily = path.join(
      dataRoot,
      "agent_alice",
      "memory",
      "timeline",
      "daily",
    );
    await fs.mkdir(daily, { recursive: true });
    const broken =
      "---\nsources: [unfinished\n---\n\n# Recovered report\n\nThe body remains readable.\n";
    const healthy =
      "---\ntitle: Healthy report\n---\n\n# Daily\n\nA separate report is intact.\n";
    await fs.writeFile(path.join(daily, "2026-11-18.md"), broken);
    await fs.writeFile(path.join(daily, "2026-11-19.md"), healthy);
    const input = {
      dataRoot,
      tenantId: "tenant_1",
      ownerActorId: "actor_alice",
    };
    const page = await listMemoryEntries(input);
    expect(page.items).toHaveLength(2);
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Recovered report",
          summary: "The body remains readable.",
          date: "2026-11-18",
        }),
        expect.objectContaining({ title: "Healthy report" }),
      ]),
    );
    for (const [title, content] of [
      ["Recovered report", broken],
      ["Healthy report", healthy],
    ]) {
      const entryId = page.items.find((item) => item.title === title)!.id;
      expect(await getMemoryEntry({ ...input, entryId })).toMatchObject({
        title,
        content,
      });
    }
    expect(await fs.readFile(path.join(daily, "2026-11-18.md"), "utf8")).toBe(
      broken,
    );
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
});
