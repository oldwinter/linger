import { Button } from "@/components/ui/button";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { pocketNotesMessages as m } from "./pocket-notes.messages";

export interface PocketNoteConflictState {
  baseText: string;
  serverText: string;
  serverUpdatedAt: string;
}

/**
 * Visible conflict resolution controls surfaced when today's Pocket Note moved
 * ahead on the server while local unsaved edits exist.
 */
export function PocketNoteConflictBar({
  conflict,
  onKeepMine,
  onKeepServer,
  onMergeBoth,
  saving,
}: {
  conflict: PocketNoteConflictState;
  onKeepMine: () => void;
  onKeepServer: () => void;
  onMergeBoth: () => void;
  saving: boolean;
}) {
  const t = useT();
  return (
    <section
      aria-label={t(m.conflictTitle)}
      className="shrink-0 border-y border-border bg-muted/60 px-4 py-2.5 text-xs"
      data-pocket-note-conflict=""
      role="alert"
    >
      <p className="font-medium text-app-ink">{t(m.conflictTitle)}</p>
      <div className="mt-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5">
        <p className="text-[11px] font-medium text-app-muted">
          {t(m.conflictServerVersion)}
        </p>
        <p className="workspace-scrollbar mt-0.5 max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs text-app-ink">
          {conflict.serverText || t(m.conflictEmptyServer)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          disabled={saving}
          onClick={onMergeBoth}
          size="compact"
          tone="primary"
        >
          {t(m.conflictMergeBoth)}
        </Button>
        <Button
          disabled={saving}
          onClick={onKeepMine}
          size="compact"
          tone="secondary"
        >
          {t(m.conflictKeepMine)}
        </Button>
        <Button
          data-voice-risk="never"
          disabled={saving}
          onClick={onKeepServer}
          size="compact"
          tone="ghost"
        >
          {t(m.conflictKeepServer)}
        </Button>
      </div>
    </section>
  );
}

/**
 * Recovery bar for an unsynced local Pocket Note draft (restored after reload,
 * offline, or failed save), with deliberate confirmation before discarding.
 */
export function PocketNoteUnsyncedDraftBar({
  confirmingDiscard,
  onCancelDiscard,
  onConfirmDiscard,
  onRequestDiscard,
  onSaveNow,
  saving,
  showSaveAction,
  storageUnavailable,
}: {
  confirmingDiscard: boolean;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
  onRequestDiscard: () => void;
  onSaveNow: () => void;
  saving: boolean;
  showSaveAction: boolean;
  storageUnavailable: boolean;
}) {
  const t = useT();
  if (confirmingDiscard) {
    return (
      <div
        aria-label={t(m.discardLocalDraft)}
        className="shrink-0 border-y border-border bg-muted/60 px-4 py-2.5 text-xs"
        data-pocket-note-discard-confirm=""
        role="alertdialog"
      >
        <p className="text-app-ink">{t(m.discardLocalDraftQuestion)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button onClick={onCancelDiscard} size="compact" tone="ghost">
            {t(commonMessages.cancel)}
          </Button>
          <Button
            data-voice-risk="never"
            onClick={onConfirmDiscard}
            size="compact"
            tone="danger"
          >
            {t(m.discardDraftConfirm)}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div
      className="shrink-0 border-y border-border bg-muted/40 px-4 py-2 text-xs"
      data-pocket-note-unsynced=""
      role="status"
    >
      <p className="font-medium text-app-ink">{t(m.unsyncedLocalDraft)}</p>
      <p className="mt-0.5 text-app-muted">
        {storageUnavailable
          ? t(m.draftStorageUnavailable)
          : t(m.unsyncedLocalDraftDetail)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {showSaveAction ? (
          <Button
            loading={saving}
            onClick={onSaveNow}
            size="compact"
            tone="secondary"
          >
            {t(m.saveDraftNow)}
          </Button>
        ) : null}
        <Button
          data-voice-risk="never"
          disabled={saving}
          onClick={onRequestDiscard}
          size="compact"
          tone="ghost"
        >
          {t(m.discardLocalDraft)}
        </Button>
      </div>
    </div>
  );
}
