import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { commonMessages } from "@/i18n/common.messages";
import { RichMessage, useT } from "@/i18n/use-translation";

import { meetingsMessages as m } from "./meetings.messages";
import { useHideMeeting } from "./memory-queries";

/** Confirms deleting a meeting from the caller's own Meetings. */
export function HideMeetingDialog({
  captureId,
  name,
  onClose,
  onHidden,
  tenantId,
}: {
  captureId: string;
  /** How the meeting is named in the list, e.g. "Meeting Oct 1, 09:05". */
  name: string;
  onClose: () => void;
  onHidden?: () => void;
  tenantId: string;
}) {
  const hide = useHideMeeting(tenantId);
  const t = useT();
  const close = () => {
    if (!hide.isPending) onClose();
  };
  return (
    <ModalDialog
      closeOnBackdrop={!hide.isPending}
      description={
        <RichMessage
          message={m.deleteBody}
          tags={{ strong: (text) => <strong>{text}</strong> }}
          values={{ name }}
        />
      }
      footer={
        <>
          <Button disabled={hide.isPending} onClick={close}>
            {t(commonMessages.cancel)}
          </Button>
          <Button
            data-voice-risk="never"
            loading={hide.isPending}
            onClick={() =>
              hide.mutate(captureId, {
                onSuccess: () => {
                  onClose();
                  onHidden?.();
                },
              })
            }
            tone="danger"
          >
            {t(commonMessages.delete)}
          </Button>
        </>
      }
      onClose={close}
      size="sm"
      title={t(m.deleteMeeting)}
    >
      {hide.isError ? (
        <p className="px-5 py-4 text-sm text-app-danger" role="alert">
          {t(m.couldNotDelete)}
        </p>
      ) : null}
    </ModalDialog>
  );
}
