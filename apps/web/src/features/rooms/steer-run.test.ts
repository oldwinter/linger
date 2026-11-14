import { describe, expect, it } from "vitest";

import type { TeamHubRuntimePresentationEventRecord } from "@/features/teamhub/teamhub-types";

import { latestPlan, planStepLabel, stopResultCopy } from "./steer-run";

function plan(
  steps: Array<{
    content: string;
    status: "completed" | "in_progress" | "pending";
  }>,
  ordinal: string,
): TeamHubRuntimePresentationEventRecord {
  return {
    event: { steps, type: "plan.updated" },
    event_ordinal: ordinal,
    segment_id: "segment-1",
  };
}

describe("latestPlan", () => {
  it("keeps the newest plan and names the step the agent is on", () => {
    const steps = latestPlan([
      plan([{ content: "Old step", status: "in_progress" }], "1"),
      plan(
        [
          { content: "Check the release", status: "completed" },
          { content: "Write the notes", status: "in_progress" },
          { content: "Send them", status: "pending" },
        ],
        "2",
      ),
    ]);
    expect(steps.map((step) => planStepLabel(step.status))).toEqual([
      "Done",
      "Doing this now",
      "Still ahead",
    ]);
    expect(steps[1]?.content).toBe("Write the notes");
    expect(stopResultCopy("cancel_requested")).toBe(
      "Stop requested. The agent will not take the next step.",
    );
  });
});
