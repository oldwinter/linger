import {
  pageTitle,
  TIMELINE_EVENT_PREFIX,
  type TimeBucket,
  type WikiGraphData,
  type WikiTimeline,
} from "./wiki-graph-model";

/** How long each day that something landed stays on screen. */
export const REEL_BEAT_MS = 900;

function occupied(bucket: TimeBucket) {
  return bucket.counts.session + bucket.counts.event > 0;
}

export function firstReelIndex(buckets: readonly TimeBucket[]) {
  const index = buckets.findIndex(occupied);
  return index < 0 ? undefined : index;
}

/** The next day something landed, and whether empty days sat in between. */
export function reelStep(
  buckets: readonly TimeBucket[],
  from: number,
): { index: number; skipped: boolean } | "end" {
  let skipped = false;
  for (let index = from + 1; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    if (!bucket) continue;
    if (occupied(bucket)) return { index, skipped };
    skipped = true;
  }
  return "end";
}

/** Session and event titles whose moment falls in this bucket. */
export function titlesInBucket(
  graph: WikiGraphData,
  timeline: WikiTimeline,
  index: number,
) {
  const titles: string[] = [];
  for (const node of graph.nodes) {
    if (timeline.nodeBuckets.get(node.id)?.includes(index))
      titles.push(pageTitle(node));
  }
  for (const event of graph.timelineEvents ?? []) {
    if (
      timeline.nodeBuckets
        .get(`${TIMELINE_EVENT_PREFIX}${event.id}`)
        ?.includes(index)
    )
      titles.push(event.title);
  }
  return titles;
}
