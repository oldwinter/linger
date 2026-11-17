import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";

interface CommentDraftStatus {
  dirty: boolean;
  submitting: boolean;
}

interface CommentsCloseRequest {
  close: () => void;
  focus: HTMLElement | null;
  pending: boolean;
}

interface CommentDraftGuard {
  remove: (id: string) => void;
  report: (id: string, status: CommentDraftStatus) => void;
  requestClose: (close: () => void) => void;
}

const CommentDraftGuardContext = createContext<CommentDraftGuard | null>(null);

export function DocumentCommentDraftGuard({
  children,
}: {
  children: ReactNode;
}) {
  const drafts = useRef(new Map<string, CommentDraftStatus>());
  const [request, setRequest] = useState<CommentsCloseRequest | null>(null);
  const clearFinishedRequest = useCallback(() => {
    const pending = [...drafts.current.values()].some(
      (draft) => draft.submitting,
    );
    setRequest((current) =>
      drafts.current.size === 0 || (current?.pending && !pending)
        ? null
        : current,
    );
  }, []);
  const report = useCallback(
    (id: string, status: CommentDraftStatus) => {
      if (status.dirty || status.submitting) drafts.current.set(id, status);
      else drafts.current.delete(id);
      clearFinishedRequest();
    },
    [clearFinishedRequest],
  );
  const remove = useCallback(
    (id: string) => {
      drafts.current.delete(id);
      clearFinishedRequest();
    },
    [clearFinishedRequest],
  );
  const requestClose = useCallback((close: () => void) => {
    if (drafts.current.size === 0) {
      close();
      return;
    }
    setRequest({
      close,
      focus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      pending: [...drafts.current.values()].some((draft) => draft.submitting),
    });
  }, []);
  const value = useMemo(
    () => ({ remove, report, requestClose }),
    [remove, report, requestClose],
  );

  function continueEditing() {
    const focus = request?.focus;
    setRequest(null);
    requestAnimationFrame(() => focus?.focus());
  }

  function discardAndClose() {
    if (!request) return;
    if ([...drafts.current.values()].some((draft) => draft.submitting)) {
      setRequest({ ...request, pending: true });
      return;
    }
    setRequest(null);
    request.close();
  }

  return (
    <CommentDraftGuardContext value={value}>
      {children}
      {request ? (
        <ModalDialog
          closeOnBackdrop
          description={
            request.pending
              ? "Wait for the current comment request to finish before closing comments."
              : "Closing comments will discard unsent comments and unsaved edits."
          }
          footer={
            <>
              <Button
                // eslint-disable-next-line jsx-a11y/no-autofocus -- Continuing the edit is the safe default when a draft may be discarded.
                autoFocus
                onClick={continueEditing}
                tone="primary"
              >
                Continue editing
              </Button>
              {!request.pending ? (
                <Button onClick={discardAndClose} tone="danger">
                  Discard and close
                </Button>
              ) : null}
            </>
          }
          onClose={continueEditing}
          size="sm"
          title={
            request.pending
              ? "Comment is still saving"
              : "Discard comment drafts?"
          }
        >
          {null}
        </ModalDialog>
      ) : null}
    </CommentDraftGuardContext>
  );
}

export function useDocumentCommentsClose() {
  return useContext(CommentDraftGuardContext)?.requestClose ?? closeComments;
}

export function useDocumentCommentDraft(initialValue = "") {
  const guard = useContext(CommentDraftGuardContext);
  const id = useId();
  const active = useRef(true);
  const status = useRef<CommentDraftStatus>({
    dirty: false,
    submitting: false,
  });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      guard?.remove(id);
    };
  }, [guard, id]);

  function report(next: CommentDraftStatus) {
    status.current = next;
    if (active.current) guard?.report(id, next);
  }

  return {
    onDraftStateChange: ({ body }: { body: string }) =>
      report({ ...status.current, dirty: body !== initialValue }),
    onSubmittingChange: (submitting: boolean) =>
      report({ ...status.current, submitting }),
  };
}

function closeComments(close: () => void) {
  close();
}
