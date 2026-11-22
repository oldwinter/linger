import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { accountIdentityText } from "@/features/apps/connection-state";
import { externalConnectionsQueryKey } from "@/features/apps/connected-apps-queries";
import { type TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubExternalConnection } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { accountSettingsMessages } from "./account-settings.messages";

export function DisconnectAccountDialog({
  client,
  connection,
  onClose,
}: {
  client: TeamHubClient;
  connection: TeamHubExternalConnection;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const disconnect = useMutation({
    mutationFn: () =>
      client.disconnectExternalConnection(connection.id, {
        expected_revision: connection.revision,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: externalConnectionsQueryKey(),
      });
      onClose();
    },
  });

  function requestClose() {
    if (!disconnect.isPending) onClose();
  }

  return (
    <ModalDialog
      closeOnBackdrop={!disconnect.isPending}
      description={t(accountSettingsMessages.disconnectDescription, {
        account:
          accountIdentityText(connection.provider, connection.identity_label) ??
          connection.provider,
      })}
      onClose={requestClose}
      size="sm"
      title={t(accountSettingsMessages.disconnectTitle)}
      footer={
        <>
          <Button
            disabled={disconnect.isPending}
            onClick={requestClose}
            size="compact"
          >
            {t(commonMessages.cancel)}
          </Button>
          <Button
            loading={disconnect.isPending}
            onClick={() => disconnect.mutate()}
            size="compact"
            tone="danger"
          >
            {t(accountSettingsMessages.disconnect)}
          </Button>
        </>
      }
    >
      {disconnect.error ? (
        <p className="px-5 py-4 text-sm text-app-danger" role="alert">
          {disconnect.error.message}
        </p>
      ) : null}
    </ModalDialog>
  );
}
