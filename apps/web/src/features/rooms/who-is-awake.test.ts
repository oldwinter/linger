import { describe, expect, it } from "vitest";

import {
  arrangeAwakeAgents,
  awakeSummary,
  type AwakeAgent,
} from "./who-is-awake";

function agent(name: string, online: boolean): AwakeAgent {
  return { actorId: name, label: online ? "Online" : "Offline", name, online };
}

describe("who is awake", () => {
  it("puts awake agents first and counts them", () => {
    const arranged = arrangeAwakeAgents([
      agent("Lev8 GTM", false),
      agent("Codex", true),
      agent("Jenny's Delegate", false),
    ]);
    expect(arranged.map((item) => item.name)).toEqual([
      "Codex",
      "Jenny's Delegate",
      "Lev8 GTM",
    ]);
    expect(awakeSummary(arranged)).toBe("1 is awake.");
    expect(awakeSummary([agent("Codex", false)])).toBe("Everyone is quiet.");
    expect(awakeSummary([agent("Codex", true), agent("Lev8 GTM", true)])).toBe(
      "2 are awake.",
    );
  });
});
