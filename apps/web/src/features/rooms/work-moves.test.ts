import { describe, expect, it } from "vitest";

import { seedTeamMd } from "@/test/teamhub-seed";

import { workMoves, workMoveText } from "./work-moves";

describe("workMoves", () => {
  it("reads who starts, who receives the work, and who it is reported to", () => {
    const steps = workMoves(seedTeamMd).map(workMoveText);
    expect(steps).toEqual([
      "Codex starts the work.",
      "Codex hands the work to Lev8 GTM.",
      "Lev8 GTM reports back to Codex.",
    ]);
  });
});
