import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { roomDialogMessages as m } from "../room-dialogs.messages";

export function DeleteAgentDialog({
  agentName,
  error,
  isPending,
  onClose,
  onDelete,
}: {
  agentName: string;
  error?: string;
  isPending: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <ModalDialog
      description={t(m.removeAgentDescription)}
      onClose={() => {
        if (!isPending) onClose();
      }}
      size="sm"
      title={t(m.removeAgentTitle, { name: agentName })}
      footer={
        <>
          <Button disabled={isPending} onClick={onClose}>
            {t(commonMessages.cancel)}
          </Button>
          <Button
            data-voice-risk="never"
            loading={isPending}
            onClick={onDelete}
            tone="danger"
          >
            {t(m.removeAgent)}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="px-5 py-4 text-sm text-app-danger" role="alert">
          {error}
        </p>
      ) : null}
    </ModalDialog>
  );
}
