import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { commonMessages } from "@/i18n/common.messages";
import { RichMessage, useT } from "@/i18n/use-translation";

import { wikiMessages as m } from "./wiki.messages";

/** Edits the whole Profile as its Markdown; TeamHub reads it back into the
 * Profile's sections, so the layout hint names what the headings mean. */
export function WikiProfileEditor({
  error,
  markdown,
  onCancel,
  onSave,
  pending,
}: {
  error?: string | null;
  markdown: string;
  onCancel: () => void;
  onSave: (markdown: string) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(markdown);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const t = useT();
  const dirty = draft !== markdown;

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(draft);
  };
  return (
    <>
      <form
        aria-label={t(m.editProfileForm)}
        className="wiki-profile-edit"
        onSubmit={submit}
      >
        <p className="wiki-profile-edit-hint">
          <RichMessage
            message={m.editHint}
            tags={{ code: (text) => <code>{text}</code> }}
          />
        </p>
        <textarea
          aria-label={t(m.profileMarkdown)}
          className="wiki-profile-edit-markdown ui-field-control"
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck
          value={draft}
        />
        <div className="wiki-profile-edit-actions">
          {error ? <FormFeedback tone="danger">{error}</FormFeedback> : null}
          <div className="wiki-profile-edit-buttons">
            <Button
              disabled={pending}
              onClick={() => {
                if (dirty) setDiscardConfirmOpen(true);
                else onCancel();
              }}
            >
              {t(commonMessages.cancel)}
            </Button>
            <Button
              disabled={!dirty}
              loading={pending}
              tone="primary"
              type="submit"
            >
              {t(commonMessages.save)}
            </Button>
          </div>
        </div>
      </form>
      {discardConfirmOpen && dirty ? (
        <ModalDialog
          closeOnBackdrop
          description="Your unsaved changes to this Profile will be lost."
          footer={
            <>
              <Button
                onClick={() => setDiscardConfirmOpen(false)}
                tone="secondary"
              >
                Keep editing
              </Button>
              <Button
                onClick={() => {
                  setDiscardConfirmOpen(false);
                  onCancel();
                }}
                tone="danger"
              >
                Discard changes
              </Button>
            </>
          }
          onClose={() => setDiscardConfirmOpen(false)}
          size="sm"
          title="Discard unsaved changes?"
        >
          {null}
        </ModalDialog>
      ) : null}
    </>
  );
}
