import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { libraryMessages as m } from "./library.messages";

export function DocumentDeleteDialog({
  error,
  onCancel,
  onConfirm,
  pending,
  title,
}: {
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  title: string;
}) {
  const t = useT();
  return (
    <ModalDialog
      closeOnBackdrop={!pending}
      description={t(m.deleteDocumentBody, { title })}
      onClose={() => {
        if (!pending) onCancel();
      }}
      size="sm"
      title={t(m.deleteDocumentTitle)}
      footer={
        <>
          <Button disabled={pending} onClick={onCancel} tone="secondary">
            {t(commonMessages.cancel)}
          </Button>
          <Button
            data-voice-risk="never"
            loading={pending}
            onClick={onConfirm}
            tone="danger"
          >
            {t(commonMessages.delete)}
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
