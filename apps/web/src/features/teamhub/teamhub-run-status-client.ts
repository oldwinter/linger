import type { operations as TeamHubPublicOperations } from "@linger/wire-contracts/teamhub-public/types";

import { runStatusView } from "./run-status";
import { teamHubData, type TeamHubApi } from "./teamhub-api";
import type {
  TeamHubRunStatusList,
  TeamHubTaskActivityPage,
} from "./teamhub-types";

type TeamHubRoomRunStatusList =
  TeamHubPublicOperations["listRoomRunStatuses"]["responses"][200]["content"]["application/json"];

export interface TeamHubRunStatusClient {
  listRoomRunStatuses(roomId: string): Promise<TeamHubRunStatusList>;
  listRoomRuntimePresentationRuns(
    roomId: string,
    messageIds: readonly string[],
    runId?: string,
  ): Promise<TeamHubRunStatusList>;
  workItems: {
    listActivities(
      taskId: string,
      page?: TeamHubPublicOperations["listTaskRuntimePresentationRuns"]["parameters"]["query"],
      options?: { signal?: AbortSignal },
    ): Promise<TeamHubTaskActivityPage>;
  };
}

function runStatusList(list: TeamHubRoomRunStatusList): TeamHubRunStatusList {
  return { items: list.items.map(runStatusView) };
}

export function createTeamHubRunStatusClient(
  api: TeamHubApi,
): TeamHubRunStatusClient {
  return {
    listRoomRunStatuses: async (roomId) =>
      runStatusList(
        await teamHubData(
          api.GET("/v0/rooms/{roomId}/run-statuses", {
            params: { path: { roomId } },
          }),
        ),
      ),
    listRoomRuntimePresentationRuns: async (roomId, messageIds, runId) =>
      runStatusList(
        await teamHubData(
          api.GET("/v0/rooms/{roomId}/runtime-presentation-runs", {
            params: {
              path: { roomId },
              query: { message_id: [...messageIds], run_id: runId },
            },
          }),
        ),
      ),
    workItems: {
      listActivities: async (taskId, query, requestOptions) => {
        const result = await teamHubData(
          api.GET("/v0/tasks/{taskId}/runtime-presentation-runs", {
            params: { path: { taskId }, query },
            signal: requestOptions?.signal,
          }),
        );
        return {
          ...result,
          active_items: result.active_items.map(runStatusView),
          history_items: result.history_items.map(runStatusView),
        };
      },
    },
  };
}
