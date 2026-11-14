import type { TeamHubRuntimePresentationEventRecord } from "@/features/teamhub/teamhub-types";

export interface SteerPlanStep {
  content: string;
  status: "canceled" | "completed" | "in_progress" | "pending";
}

const stepLabel: Record<SteerPlanStep["status"], string> = {
  canceled: "Canceled",
  completed: "Done",
  in_progress: "Doing this now",
  pending: "Still ahead",
};

export function steerRunPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/steer`;
}

/** The plan the run last published. Later plan events replace earlier ones. */
export function latestPlan(
  records: readonly TeamHubRuntimePresentationEventRecord[],
): SteerPlanStep[] {
  let steps: SteerPlanStep[] = [];
  for (const record of records) {
    if (record.event.type !== "plan.updated") continue;
    steps = record.event.steps.map((step) => ({
      content: step.content,
      status: step.status,
    }));
  }
  return steps;
}

export function planStepLabel(status: SteerPlanStep["status"]) {
  return stepLabel[status];
}

export function stopResultCopy(
  status: "already_terminal" | "cancel_requested" | "canceled",
) {
  if (status === "already_terminal") return "This run had already finished.";
  return "Stop requested. The agent will not take the next step.";
}
