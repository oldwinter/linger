import { queryOptions } from "@tanstack/react-query";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubProactiveMandate } from "@/features/teamhub/teamhub-types";

export const myRulesQueryKey = (tenantId: string) =>
  ["teamhub", "proactive-rules", tenantId] as const;

export function myRulesQueryOptions(client: TeamHubClient, tenantId: string) {
  return queryOptions({
    queryKey: myRulesQueryKey(tenantId),
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/me/proactive-rules", {
          params: { path: { tenantId } },
        }),
      ),
    // Nightly learning and Another Me's judgments change it while away.
    staleTime: 0,
  });
}

/** One rule command; each answers with the whole rule book after it. */
export type MyRulesCommand =
  | { kind: "pin"; ruleId: string; pinned: boolean }
  | { kind: "edit"; ruleId: string; text: string }
  | { kind: "delete"; ruleId: string }
  | { kind: "promote"; ruleId: string }
  | { kind: "mandate"; ruleId: string; mandate: TeamHubProactiveMandate };

export function runMyRulesCommand(
  client: TeamHubClient,
  tenantId: string,
  command: MyRulesCommand,
) {
  const path = { tenantId, ruleId: command.ruleId };
  switch (command.kind) {
    case "pin":
      return teamHubData(
        client.api.PUT(
          "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}/pin",
          {
            body: { pinned: command.pinned },
            params: { path },
          },
        ),
      );
    case "edit":
      return teamHubData(
        client.api.PATCH("/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}", {
          body: { text: command.text },
          params: { path },
        }),
      );
    case "delete":
      return teamHubData(
        client.api.DELETE(
          "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}",
          {
            params: { path },
          },
        ),
      );
    case "mandate":
      return teamHubData(
        client.api.PUT(
          "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}/mandate",
          { body: { mandate: command.mandate }, params: { path } },
        ),
      );
    case "promote":
      return teamHubData(
        client.api.POST(
          "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}/promotion",
          { params: { path } },
        ),
      );
  }
}
