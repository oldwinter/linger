import { useQuery } from "@tanstack/react-query";

import { externalConnectionsQueryOptions } from "@/features/apps/connected-apps-queries";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";

export function CanvasMailSender({ client }: { client: TeamHubClient }) {
  const connections = useQuery(externalConnectionsQueryOptions(client));
  const accounts = connections.data?.connections.filter(
    (connection) =>
      connection.provider === "gmail" && connection.status === "active",
  );
  return (
    <span>
      {accounts?.length === 1
        ? accounts[0]?.identity_label || "Connected Gmail account"
        : "Gmail account"}
    </span>
  );
}
