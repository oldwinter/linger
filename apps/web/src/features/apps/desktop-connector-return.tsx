import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { isExternalSourceAccountQuery } from "./connected-apps-queries";
import { desktopConnectorOAuth } from "./desktop-connector-oauth";

export function DesktopConnectorReturn() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      desktopConnectorOAuth()?.onReturn((connectedAccountId) => {
        void client
          .completeExternalConnectionAuthorization(connectedAccountId)
          .catch(() => undefined)
          .then(() =>
            queryClient.invalidateQueries({
              predicate: ({ queryKey }) =>
                isExternalSourceAccountQuery(queryKey),
            }),
          );
      }),
    [client, queryClient],
  );
  return null;
}
