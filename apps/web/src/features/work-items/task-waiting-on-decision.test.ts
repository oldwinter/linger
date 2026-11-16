import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { taskWaitingOnDecision } from "./task-waiting-on-decision";

describe("task waiting on a decision", () => {
  it("returns the task whose conversation still carries that decision", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.seed.workItems = [
      task("task-other", "Other work", "decision-other"),
      task("task-held", "Send the report", "decision-held"),
    ];
    runtime.server.on("GET", "/v0/tasks/{taskId}/conversation", ({ params }) =>
      conversation(
        params.taskId === "task-held" ? "decision-held" : "decision-other",
      ),
    );

    await expect(
      taskWaitingOnDecision(
        runtime.client,
        "tenant-northstar",
        "decision-held",
      ),
    ).resolves.toEqual({ id: "task-held", title: "Send the report" });
  });

  it("returns nothing when no waiting task carries the decision", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.seed.workItems = [
      task("task-held", "Send the report", "decision-held"),
    ];
    runtime.server.on("GET", "/v0/tasks/{taskId}/conversation", () =>
      conversation("decision-held"),
    );

    await expect(
      taskWaitingOnDecision(runtime.client, "tenant-northstar", "decision-room"),
    ).resolves.toBeUndefined();
  });
});

function task(
  id: string,
  title: string,
  decisionId: string,
): TeamHubWorkItem {
  return {
    assignees: [],
    created_at: "2026-11-16T01:00:00Z",
    created_by: actor,
    description: decisionId,
    explicit_access_grants: [],
    id,
    kind: "task",
    number: 1,
    priority: "medium",
    referenced_actors: [],
    state: "in_progress",
    task_execution: {
      control_revision: 0,
      control_settled_revision: 0,
      desired_control: "run",
      execution_revision: 1,
      execution_updated_at: "2026-11-16T01:00:00Z",
      generation: 1,
      pending_control: false,
      status: "waiting_for_approval",
    },
    tenant_id: "tenant-northstar",
    title,
    updated_at: "2026-11-16T01:00:00Z",
    updated_by: actor,
    version: 1,
  };
}

const actor = {
  display_name: "Jenny Bin",
  id: "actor-jenny",
  kind: "human" as const,
  tenant_id: "tenant-northstar",
};

function conversation(decisionId: string) {
  return {
    cards: [
      {
        created_at: "2026-11-16T01:00:00Z",
        decision_id: decisionId,
        message_id: `message-${decisionId}`,
        room_id: "room-product-v0",
      },
    ],
    inputs: [],
  };
}
