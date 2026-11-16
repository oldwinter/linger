import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";

/** The task a decision was holding, as the person it belongs to would open it. */
export interface TaskWaitingOnDecision {
  id: string;
  title: string;
}

/**
 * The task in this person's work that is waiting on this decision.
 * The list is their own projection, and a task is waiting when its
 * conversation still carries the decision.
 */
export async function taskWaitingOnDecision(
  client: Pick<TeamHubClient, "api">,
  tenantId: string,
  decisionId: string,
): Promise<TaskWaitingOnDecision | undefined> {
  const page = await teamHubData(
    client.api.GET("/v0/tenants/{tenantId}/work-items", {
      params: {
        path: { tenantId },
        query: {
          execution_status: "waiting_for_approval",
          kind: "task",
          limit: 20,
          scope: "personal",
        },
      },
    }),
  );
  const tasks = page.items.filter(
    (item) => item.kind === "task" && item.tenant_id === tenantId,
  );
  const conversations = await Promise.all(
    tasks.map(async (task) => {
      try {
        const conversation = await teamHubData(
          client.api.GET("/v0/tasks/{taskId}/conversation", {
            params: { path: { taskId: task.id } },
          }),
        );
        return { conversation, task };
      } catch {
        return undefined;
      }
    }),
  );
  const match = conversations.find((entry) =>
    entry?.conversation.cards.some((card) => card.decision_id === decisionId),
  );
  if (!match) return undefined;
  return { id: match.task.id, title: match.task.title };
}
