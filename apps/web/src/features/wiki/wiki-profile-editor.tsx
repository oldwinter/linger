import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { ModalDialog } from "@/components/ui/modal-dialog";

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
        aria-label="Edit Profile"
        className="wiki-profile-edit"
        onSubmit={submit}
      >
        <p className="wiki-profile-edit-hint">
          Keep the five <code>##</code> sections. Under Background,{" "}
          <code>### Timeline</code> lists <code>- years · organization</code>{" "}
          entries with years only (<code>2019</code> start, <code>–2013</code>{" "}
          end, <code>≤2013</code> ended by then, <code>Present</code> ongoing);
          any other <code>###</code> starts a point.
        </p>
        <textarea
          aria-label="Profile Markdown"
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
              Cancel
            </Button>
            <Button
              disabled={!dirty}
              loading={pending}
              tone="primary"
              type="submit"
            >
              Save
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
