import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  nodeMoments,
  type WikiGraphData,
} from "./wiki-graph-model";
import { firstReelIndex, reelStep, titlesInBucket } from "./year-reel";

const graph: WikiGraphData = {
  types: ["Session"],
  nodes: [
    {
      id: "sessions/2026-09-01/capture_session_a",
      title: "Kickoff meeting",
      category: "Session",
      description: "",
      tags: [],
      body: "",
      size: 1,
      links: [],
      backlinks: [],
    },
    {
      id: "sessions/2026-09-03/capture_session_b",
      title: "Review meeting",
      category: "Session",
      description: "",
      tags: [],
      body: "",
      size: 1,
      links: [],
      backlinks: [],
    },
  ],
  edges: [],
  timelineEvents: [
    { id: "event-1", day: "2026-09-03", title: "Product launch" },
  ],
};

describe("year reel", () => {
  const timeline = buildTimeline(nodeMoments(graph), "day", "2026-09-03");

  it("starts on the first day something landed and skips empty days", () => {
    const start = firstReelIndex(timeline.buckets);
    expect(start).toBe(0);
    expect(timeline.buckets[0]?.start).toBe("2026-09-01");
    expect(reelStep(timeline.buckets, start!)).toEqual({
      index: 2,
      skipped: true,
    });
    expect(reelStep(timeline.buckets, 2)).toBe("end");
  });

  it("names the pages and events that landed in a bucket", () => {
    expect(titlesInBucket(graph, timeline, 0)).toEqual(["Kickoff meeting"]);
    expect(titlesInBucket(graph, timeline, 2)).toEqual([
      "Review meeting",
      "Product launch",
    ]);
    expect(firstReelIndex([])).toBeUndefined();
  });
});
