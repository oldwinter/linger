import { teamHubData, type TeamHubApi } from "./teamhub-api";
import type { TeamHubLocalComputerPage } from "./teamhub-types";

export interface TeamHubAgentClient {
  listTenantLocalComputers(tenantId: string): Promise<TeamHubLocalComputerPage>;
}

export function createTeamHubAgentClient(api: TeamHubApi): TeamHubAgentClient {
  return {
    listTenantLocalComputers: async (tenantId) => {
      const page = await teamHubData(
        api.GET("/v0/tenants/{tenantId}/local-computers", {
          params: { path: { tenantId } },
        }),
      );
      return {
        ...page,
        items: page.items.map((computer) => ({
          ...computer,
          runtimes: computer.runtimes.filter(
            ({ type }) =>
              type === "codex" ||
              type === "claude" ||
              type === "pi" ||
              type === "antigravity",
          ),
        })),
      };
    },
  };
}
