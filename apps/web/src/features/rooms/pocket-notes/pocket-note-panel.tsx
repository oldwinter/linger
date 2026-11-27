import { suppressFollowUpClick } from "@/components/ui/suppress-follow-up-click";
import {
  ArrowLeft01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  GridViewIcon,
  Mic01Icon,
  Search01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { MessageMarkdown } from "../chat/message-markdown";
import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import { HighlightedText } from "@/features/search/search-highlight";
import { spokenSeparator } from "../chat/voice-mode/spoken-text";
import { triggerArtifactDownload } from "../files/artifact-preview-loader";
import { Icon } from "@/components/ui/icon";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { teamHubData, teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

import { Button } from "@/components/ui/button";
import { commonMessages } from "@/i18n/common.messages";
import { formatLocale } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";

import {
  fetchTodayPocketNote,
  pocketNotesQueryKey,
  pocketNotesQueryOptions,
  removePocketNote,
  storeTodayPocketNote,
} from "./pocket-note-queries";
import {
  isPocketNoteConflictError,
  mergePocketNoteConflict,
} from "./pocket-note-conflict";
import {
  broadcastPocketNoteUpdated,
  clearPocketNoteDraft,
  localPocketNoteDate,
  pocketNoteExpectedUpdatedAt,
  readPocketNoteDraft,
  subscribePocketNoteUpdates,
  writePocketNoteDraft,
  type PocketNoteDraftScope,
} from "./pocket-note-draft";
import {
  PocketNoteConflictBar,
  PocketNoteUnsyncedDraftBar,
  type PocketNoteConflictState,
} from "./pocket-note-recovery-bars";
import {
  POCKET_NOTES_FILENAME,
  pocketNoteFilename,
  pocketNoteMarkdown,
  pocketNotesMarkdown,
} from "./pocket-notes-export";
import { TellAnotherMe } from "./tell-another-me-control";
import { LazyVoiceKeyDialog } from "@/features/rooms/voice-control/lazy-voice-key-dialog";
import { appendToPocketNote } from "./pocket-note-append";
import { pocketNoteBefore } from "./pocket-note-before";
import { pocketNoteCopyText } from "./pocket-note-copy";
import { groupPocketNotesByMonth } from "./pocket-note-months";
import { todayNoteOutOfView } from "./pocket-note-today-jump";
import { pocketNotesMessages as m } from "./pocket-notes.messages";
import { usePocketDictation } from "./use-pocket-dictation";
import {
  PocketNoteEditor,
  type PocketNoteEditorHandle,
} from "./pocket-note-editor";
import { registerPocketNoteClose } from "./pocket-note-hold";
import { searchPocketNotes } from "./pocket-note-search";

const autosaveDelayMs = 800;
/** Long enough to read, matching the other copy actions. */
const copiedFeedbackMs = 1200;
/** Long enough for the eye to find today's card, short enough to forget. */
const todayMarkMs = 1200;
const maximumNoteLength = 20000;
const panelWidth = 360;
const panelHeight = 440;
const panelGap = 12;
/** Matches Tailwind's `sm` breakpoint, below which the modal backdrop is shown. */
const narrowBackdropMaxWidth = 640;
const noteActionClass =
  "flex size-6 items-center justify-center rounded-md text-app-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus disabled:pointer-events-none disabled:opacity-40";

type PocketNoteView =
  | { kind: "today" }
  | { kind: "all" }
  | { kind: "past"; note: TeamHubPocketNote };

/** Keeps the page open until its last words have been saved. */
interface CloseGuard {
  /** The microphone is still open; Escape stops it before anything else. */
  listening: () => boolean;
  /** Handles an inner step (clearing a dialog/filter) before closing the panel. */
  onEscape?: () => boolean;
  /** Settles the last words into the page; it may be about to close. */
  stop: () => Promise<void>;
  /** A failed save leaves the editor available for recovery. */
  beforeLeave?: () => Promise<void> | undefined;
}

export default function PocketNotePanel({
  accountId: accountIdProp,
  anchor,
  anotherMeRoomId,
  closeRef,
  onClose,
  onOpenChat,
  tenantId,
}: {
  /** Signed-in account ID isolating local recovery drafts; falls back to /v0/me. */
  accountId?: string;
  /** The toolbar button, when that room's navigation is on screen. */
  anchor: HTMLButtonElement | null;
  anotherMeRoomId?: string;
  /** Receives the guarded close, so the trigger closes the same way. */
  closeRef: RefObject<(() => void) | undefined>;
  onClose: () => void;
  /** Opens Another Me's chat after today's note has been sent there. */
  onOpenChat?: () => void;
  tenantId: string;
}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const identity = useQuery({
    ...teamHubIdentityQueryOptions(client),
    enabled: !accountIdProp,
  });
  const accountId = accountIdProp ?? identity.data?.account.id;
  const notes = useInfiniteQuery(pocketNotesQueryOptions(client, tenantId));
  const [view, setView] = useState<PocketNoteView>({ kind: "today" });
  const [autoSaveRecoveredOnce, setAutoSaveRecoveredOnce] = useState(false);
  const [offlineDraftVersion, setOfflineDraftVersion] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = usePanelPosition(anchor);
  const closeGuard = useRef<CloseGuard | undefined>(undefined);
  const close = () => {
    const pending = closeGuard.current?.beforeLeave?.();
    if (pending) {
      return pending.then(
        () => {
          if (!panelRef.current) return false;
          onClose();
          return true;
        },
        () => false,
      );
    }
    onClose();
    return true;
  };
  const latestClose = useRef(close);
  useLayoutEffect(() => {
    latestClose.current = close;
    closeRef.current = () => void close();
    registerPocketNoteClose(() => void close());
    return () => registerPocketNoteClose(undefined);
  });
  useLayoutEffect(
    () => () => {
      closeRef.current = undefined;
    },
    [closeRef],
  );

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      const targetElement =
        target instanceof Element ? target : target.parentElement;
      if (
        document.querySelector("dialog[open]") ||
        panelRef.current?.contains(target) ||
        anchor?.contains(target) ||
        targetElement?.closest(
          "nav, .app-primary-navigation, .app-secondary-navigation, .room-secondary-navigation, [data-navigation-surface]",
        )
      ) {
        return;
      }
      // The paired click would otherwise activate the control under the panel.
      if ((event.button ?? 0) === 0) suppressFollowUpClick(event);
      void latestClose.current();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        document.querySelector("dialog[open]")
      ) {
        return;
      }
      event.preventDefault();
      const guard = closeGuard.current;
      if (guard?.listening()) {
        void guard.stop();
        return;
      }
      if (guard?.onEscape?.()) return;
      void Promise.resolve(latestClose.current()).then((closed) => {
        if (closed) anchor?.focus();
      });
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [anchor, onClose]);

  const firstPage = notes.data?.pages[0];
  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const today = firstPage?.today;
  const todayNote = items.find((item) => item.date === today);
  const waitingForIdentity = !accountIdProp && identity.isPending;
  const offlineDate = localPocketNoteDate();
  const offlineDraft =
    !firstPage && notes.isError && accountId && offlineDraftVersion >= 0
      ? readPocketNoteDraft({ accountId, date: offlineDate, tenantId })
      : undefined;
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  async function retryOfflineLoad() {
    const result = await notes.refetch();
    if (!result.isError && result.data?.pages[0]?.today) {
      setAutoSaveRecoveredOnce(true);
    }
  }

  /**
   * Loads every page still on the server before writing the file, so the
   * download holds all of the person's notes. A page that fails to load saves
   * nothing.
   */
  async function downloadAll() {
    setDownloadFailed(false);
    setDownloading(true);
    try {
      let result = await notes.fetchNextPage();
      while (!result.isError && result.hasNextPage) {
        result = await notes.fetchNextPage();
      }
      if (result.isError) throw result.error;
      const pages = result.data?.pages.flatMap((page) => page.items) ?? [];
      triggerArtifactDownload(
        new Blob([pocketNotesMarkdown(pages)], {
          type: "text/markdown;charset=utf-8",
        }),
        POCKET_NOTES_FILENAME,
      );
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  /**
   * Saves one page on its own, formatted exactly as the all-notes file writes
   * it. The page is already loaded, so this reads no more of the list.
   */
  function downloadNote(note: TeamHubPocketNote) {
    setDownloadFailed(false);
    try {
      triggerArtifactDownload(
        new Blob([pocketNoteMarkdown(note)], {
          type: "text/markdown;charset=utf-8",
        }),
        pocketNoteFilename(note.date),
      );
    } catch {
      setDownloadFailed(true);
    }
  }

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[99] bg-black/25 backdrop-blur-[1px] sm:hidden"
        onClick={() => void close()}
      />
      <div
        aria-label={t(m.panel)}
        className="app-floating-enter fixed z-[100] flex h-[440px] max-h-[calc(100dvh-24px)] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl bg-popover shadow-xl"
        ref={panelRef}
        role="dialog"
        style={position}
      >
        {offlineDraft ? (
          <TodayPocketNote
            accountId={accountId}
            anotherMeRoomId={anotherMeRoomId}
            closeGuard={closeGuard}
            key={`${accountId ?? ""}:${tenantId}:${offlineDate}:offline`}
            offlineLoad
            onClose={() => void close()}
            onOfflineDraftDiscarded={() => {
              setOfflineDraftVersion((value) => value + 1);
            }}
            onOpenChat={onOpenChat}
            onRetryLoad={retryOfflineLoad}
            onShowAll={() => setView({ kind: "all" })}
            storedText={offlineDraft.baseText}
            storedUpdatedAt={offlineDraft.baseUpdatedAt}
            tenantId={tenantId}
            today={offlineDate}
          />
        ) : !firstPage || !today || waitingForIdentity ? (
          <>
            <PocketNoteHeader onClose={() => void close()} title={t(m.panel)} />
            {notes.isError ? (
              <div
                className="m-auto flex flex-col items-center gap-2.5 px-4 pb-8 text-center"
                role="alert"
              >
                <p className="text-sm text-app-muted">{t(m.couldNotLoad)}</p>
                <Button
                  onClick={() => void notes.refetch()}
                  size="compact"
                  tone="secondary"
                >
                  {t(commonMessages.retry)}
                </Button>
              </div>
            ) : (
              <p className="m-auto pb-8 text-sm text-app-muted">
                {t(commonMessages.loading)}
              </p>
            )}
          </>
        ) : view.kind === "all" ? (
          <AllPocketNotes
            closeGuard={closeGuard}
            downloadFailed={downloadFailed}
            downloading={downloading}
            hasMore={notes.hasNextPage}
            items={items}
            loadingMore={notes.isFetchingNextPage}
            onClose={onClose}
            onDownloadAll={() => void downloadAll()}
            onDownloadNote={downloadNote}
            onLoadMore={() => void notes.fetchNextPage()}
            onOpen={(note) =>
              setView(
                note.date === today
                  ? { kind: "today" }
                  : { kind: "past", note },
              )
            }
            tenantId={tenantId}
            today={today}
          />
        ) : view.kind === "today" ? (
          <TodayPocketNote
            accountId={accountId}
            anotherMeRoomId={anotherMeRoomId}
            autoSaveRecovered={autoSaveRecoveredOnce}
            closeGuard={closeGuard}
            earlier={pocketNoteBefore(items, today)}
            key={`${accountId ?? ""}:${tenantId}:${today}`}
            onAutoSaveRecoveredConsumed={() => setAutoSaveRecoveredOnce(false)}
            onClose={() => void close()}
            onOpenChat={onOpenChat}
            onShowAll={() => setView({ kind: "all" })}
            storedText={todayNote?.text ?? ""}
            storedUpdatedAt={pocketNoteExpectedUpdatedAt(todayNote)}
            tenantId={tenantId}
            today={today}
          />
        ) : (
          <PastPocketNote
            note={view.note}
            onBack={() => setView({ kind: "all" })}
            onClose={onClose}
          />
        )}
      </div>
    </>,
    document.body,
  );
}

function initialTodayRecovery({
  offlineLoad,
  scope,
  storedText,
  storedUpdatedAt,
}: {
  offlineLoad: boolean;
  scope?: PocketNoteDraftScope;
  storedText: string;
  storedUpdatedAt?: string;
}): {
  conflict?: PocketNoteConflictState;
  restoredDraft: boolean;
  staleDraftToClear: boolean;
  text: string;
} {
  if (!scope) {
    return { restoredDraft: false, staleDraftToClear: false, text: storedText };
  }
  const recovered = readPocketNoteDraft(scope);
  if (!recovered) {
    return { restoredDraft: false, staleDraftToClear: false, text: storedText };
  }
  if (!offlineLoad && recovered.text === storedText) {
    return { restoredDraft: false, staleDraftToClear: true, text: storedText };
  }
  const currentUpdatedAt = storedUpdatedAt ?? "";
  const serverMoved =
    !offlineLoad &&
    recovered.baseText !== storedText &&
    recovered.baseUpdatedAt !== currentUpdatedAt;
  if (serverMoved) {
    return {
      conflict: {
        baseText: recovered.baseText,
        serverText: storedText,
        serverUpdatedAt: currentUpdatedAt,
      },
      restoredDraft: false,
      staleDraftToClear: false,
      text: recovered.text,
    };
  }
  return {
    restoredDraft: true,
    staleDraftToClear: false,
    text: recovered.text,
  };
}

function TodayPocketNote({
  accountId,
  anotherMeRoomId,
  autoSaveRecovered = false,
  closeGuard,
  earlier,
  offlineLoad = false,
  onAutoSaveRecoveredConsumed,
  onClose,
  onOfflineDraftDiscarded,
  onOpenChat,
  onRetryLoad,
  onShowAll,
  storedText,
  storedUpdatedAt,
  tenantId,
  today,
}: {
  accountId?: string;
  anotherMeRoomId?: string;
  autoSaveRecovered?: boolean;
  closeGuard: RefObject<CloseGuard | undefined>;
  /** The newest written page before today, read on the same paper. */
  earlier?: TeamHubPocketNote;
  /** True when today's page is rendered from a local recovery draft while TeamHub is unreachable. */
  offlineLoad?: boolean;
  onAutoSaveRecoveredConsumed?: () => void;
  /** Today's saved text, which a save from elsewhere can change underneath. */
  storedText: string;
  /** Server updated_at token for today's page ("" when empty, undefined only for synthetic empty timestamps). */
  storedUpdatedAt?: string;
  onClose: () => void;
  onOfflineDraftDiscarded?: () => void;
  onOpenChat?: () => void;
  onRetryLoad?: () => Promise<void>;
  onShowAll: () => void;
  tenantId: string;
  today: string;
}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const scope: PocketNoteDraftScope | undefined = accountId
    ? { accountId, date: today, tenantId }
    : undefined;
  const [initial] = useState(() =>
    initialTodayRecovery({
      offlineLoad,
      scope,
      storedText,
      storedUpdatedAt,
    }),
  );
  const [text, setText] = useState(initial.text);
  const [savedTextState, setSavedTextState] = useState(storedText);
  const [restoredDraft, setRestoredDraft] = useState(initial.restoredDraft);
  const [userEdited, setUserEdited] = useState(false);
  const [conflict, setConflict] = useState<PocketNoteConflictState | undefined>(
    initial.conflict,
  );
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [retryingOfflineLoad, setRetryingOfflineLoad] = useState(false);

  const textRef = useRef(initial.text);
  const savedText = useRef(storedText);
  const savedUpdatedAt = useRef<string | undefined>(storedUpdatedAt);
  const storedRef = useRef(storedText);
  const storedUpdatedAtRef = useRef<string | undefined>(storedUpdatedAt);
  const conflictRef = useRef<PocketNoteConflictState | undefined>(
    initial.conflict,
  );
  const restoredDraftRef = useRef(initial.restoredDraft);
  const userEditedRef = useRef(false);
  const lastFailedTextRef = useRef<string | undefined>(undefined);
  const saving = useRef<Promise<void> | undefined>(undefined);
  const editorRef = useRef<PocketNoteEditorHandle>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const anchor = useRef(0);
  // Where this dictation began; later turns continue its paragraph.
  const blockStart = useRef(0);
  const [truncated, setTruncated] = useState(false);

  function setConflictState(next: PocketNoteConflictState | undefined) {
    conflictRef.current = next;
    setConflict(next);
  }

  function setRestoredDraftState(next: boolean) {
    restoredDraftRef.current = next;
    setRestoredDraft(next);
  }

  function setSavedBaseline(nextText: string, nextUpdatedAt?: string) {
    savedText.current = nextText;
    savedUpdatedAt.current = nextUpdatedAt;
    setSavedTextState(nextText);
  }

  const save = useMutation({
    mutationFn: (input: { expectedUpdatedAt?: string; text: string }) =>
      teamHubData(
        client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
          params: { path: { tenantId } },
          body: {
            text: input.text,
            ...(input.expectedUpdatedAt !== undefined
              ? { expected_updated_at: input.expectedUpdatedAt }
              : {}),
          },
        }),
      ),
    onSuccess: (note) => {
      const nextUpdatedAt = pocketNoteExpectedUpdatedAt(note);
      lastFailedTextRef.current = undefined;
      setSavedBaseline(note.text, nextUpdatedAt);
      setRestoredDraftState(false);
      setStorageUnavailable(false);
      setConfirmingDiscard(false);
      setConflictState(undefined);
      storeTodayPocketNote(queryClient, tenantId, note);
      broadcastPocketNoteUpdated({ accountId, note, tenantId });
      if (scope) {
        if (textRef.current === note.text) {
          clearPocketNoteDraft(scope);
        } else {
          // Edits made while this PUT was in flight stay protected under the
          // newly confirmed server baseline.
          const persisted = writePocketNoteDraft(scope, {
            baseText: note.text,
            baseUpdatedAt: nextUpdatedAt ?? "",
            text: textRef.current,
            updatedAt: new Date().toISOString(),
          });
          setStorageUnavailable(!persisted);
        }
      }
    },
  });
  const persist = useEffectEvent(() => {
    void ensureSaved().catch(() => {});
  });
  const resetSaveMutation = useEffectEvent(() => {
    save.reset();
  });
  const consumeAutoSaveRecovered = useEffectEvent(() => {
    onAutoSaveRecoveredConsumed?.();
  });

  useEffect(() => {
    if (initial.staleDraftToClear && accountId) {
      clearPocketNoteDraft({ accountId, date: today, tenantId });
    }
  }, [accountId, initial.staleDraftToClear, tenantId, today]);

  useEffect(() => {
    if (!autoSaveRecovered || offlineLoad) return;
    consumeAutoSaveRecovered();
    if (!conflictRef.current && textRef.current !== savedText.current) {
      persist();
    }
  }, [autoSaveRecovered, offlineLoad]);

  useEffect(() => {
    if (!accountId || offlineLoad) return;
    return subscribePocketNoteUpdates(
      { accountId, date: today, tenantId },
      {
        onNote: (note) => {
          storeTodayPocketNote(queryClient, tenantId, note);
        },
        onRemoteChange: () => {
          void queryClient.invalidateQueries({
            queryKey: pocketNotesQueryKey(tenantId),
          });
        },
      },
    );
  }, [accountId, offlineLoad, queryClient, tenantId, today]);

  function update(value: string) {
    textRef.current = value;
    userEditedRef.current = true;
    lastFailedTextRef.current = undefined;
    setText(value);
    setUserEdited(true);
    setConfirmingDiscard(false);
    if (!scope) return;
    if (!offlineLoad && !conflictRef.current && value === savedText.current) {
      clearPocketNoteDraft(scope);
      setRestoredDraftState(false);
      setStorageUnavailable(false);
      return;
    }
    const persisted = writePocketNoteDraft(scope, {
      baseText: conflictRef.current?.baseText ?? savedText.current,
      baseUpdatedAt: savedUpdatedAt.current ?? "",
      text: value,
      updatedAt: new Date().toISOString(),
    });
    setStorageUnavailable(!persisted);
  }

  /**
   * A dictation starts its own line at the anchor; later turns of the same
   * dictation continue that paragraph, so pauses do not chop it into lines.
   */
  function insertSpoken(spoken: string) {
    const words = spoken.trim();
    if (!words) return;
    const current = textRef.current;
    const at = Math.min(anchor.current, current.length);
    const before = current.slice(0, at);
    const after = current.slice(at);
    const continuing = at > blockStart.current;
    const separator = continuing
      ? spokenSeparator(before, words)
      : before && !before.endsWith("\n")
        ? "\n"
        : "";
    const piece = `${separator}${words}`;
    const tail = after && !after.startsWith("\n") ? `\n${after}` : after;
    const room = maximumNoteLength - before.length - tail.length;
    const fitted = piece.slice(0, Math.max(0, room));
    if (fitted.length < piece.length) setTruncated(true);
    anchor.current = before.length + fitted.length;
    update(before + fitted + tail);
  }

  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const dictation = usePocketDictation({
    onTurn: insertSpoken,
    roomId: anotherMeRoomId,
    tenantId,
  });
  // One stop at a time: a second request while the last words drain would
  // otherwise write them twice.
  const stopping = useRef<Promise<void> | undefined>(undefined);
  function stopDictation() {
    stopping.current ??= (async () => {
      try {
        insertSpoken(await dictation.stop());
      } finally {
        stopping.current = undefined;
      }
    })();
    return stopping.current;
  }

  useLayoutEffect(() => {
    closeGuard.current = {
      beforeLeave,
      listening: () => dictation.active && !dictation.stopping,
      onEscape: () => {
        if (confirmingDiscard) {
          setConfirmingDiscard(false);
          return true;
        }
        return false;
      },
      stop: stopDictation,
    };
    return () => {
      closeGuard.current = undefined;
    };
  });

  // External saves (Message menu or another tab) update the query cache.
  // Clean pages take the new text; pure appends merge onto an unsaved draft
  // and advance its baseline; competing edits open conflict resolution instead
  // of silently overwriting on the next autosave.
  useEffect(() => {
    if (offlineLoad) return;
    if (
      storedText === storedRef.current &&
      storedUpdatedAt === storedUpdatedAtRef.current
    ) {
      return;
    }
    const previousText = storedRef.current;
    const previousUpdatedAt = storedUpdatedAtRef.current;
    storedRef.current = storedText;
    storedUpdatedAtRef.current = storedUpdatedAt;
    if (saving.current) return;
    if (
      storedText === savedText.current &&
      storedUpdatedAt === savedUpdatedAt.current &&
      !conflictRef.current
    ) {
      return;
    }
    if (
      conflictRef.current &&
      conflictRef.current.serverText === storedText &&
      conflictRef.current.serverUpdatedAt === (storedUpdatedAt ?? "")
    ) {
      return;
    }
    if (textRef.current === savedText.current && !conflictRef.current) {
      setSavedBaseline(storedText, storedUpdatedAt);
      textRef.current = storedText;
      setText(storedText);
      return;
    }
    if (storedText === textRef.current) {
      lastFailedTextRef.current = undefined;
      setSavedBaseline(storedText, storedUpdatedAt);
      setRestoredDraftState(false);
      setConflictState(undefined);
      setConfirmingDiscard(false);
      setStorageUnavailable(false);
      resetSaveMutation();
      if (accountId) clearPocketNoteDraft({ accountId, date: today, tenantId });
      return;
    }
    if (
      !conflictRef.current &&
      storedText.startsWith(previousText) &&
      storedText.length > previousText.length
    ) {
      const merged = appendToPocketNote(
        textRef.current,
        storedText.slice(previousText.length),
      );
      setSavedBaseline(storedText, storedUpdatedAt);
      textRef.current = merged;
      setText(merged);
      if (accountId) {
        const persisted = writePocketNoteDraft(
          { accountId, date: today, tenantId },
          {
            baseText: storedText,
            baseUpdatedAt: storedUpdatedAt ?? "",
            text: merged,
            updatedAt: new Date().toISOString(),
          },
        );
        setStorageUnavailable(!persisted);
      }
      return;
    }
    const baseText = conflictRef.current?.baseText ?? previousText;
    setConflictState({
      baseText,
      serverText: storedText,
      serverUpdatedAt: storedUpdatedAt ?? "",
    });
    setRestoredDraftState(false);
    setConfirmingDiscard(false);
    if (accountId) {
      const persisted = writePocketNoteDraft(
        { accountId, date: today, tenantId },
        {
          baseText,
          baseUpdatedAt: previousUpdatedAt ?? "",
          text: textRef.current,
          updatedAt: new Date().toISOString(),
        },
      );
      setStorageUnavailable(!persisted);
    }
  }, [accountId, offlineLoad, storedText, storedUpdatedAt, tenantId, today]);

  useEffect(() => {
    if (
      offlineLoad ||
      conflict ||
      text === savedTextState ||
      (restoredDraft && !userEdited)
    ) {
      return;
    }
    const timer = window.setTimeout(() => persist(), autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [conflict, offlineLoad, restoredDraft, savedTextState, text, userEdited]);

  // Closing the notepad inside the autosave delay must not drop the last words.
  useEffect(
    () => () => {
      if (
        !offlineLoad &&
        !conflictRef.current &&
        !(restoredDraftRef.current && !userEditedRef.current) &&
        lastFailedTextRef.current !== textRef.current &&
        textRef.current !== savedText.current
      ) {
        persist();
      }
    },
    [offlineLoad],
  );

  // Keep the words being spoken in view, and hand the caret back after them.
  const dictating = dictation.active;
  useLayoutEffect(() => {
    if (dictating) liveRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [dictating, dictation.liveText, text]);
  const wasDictating = useRef(false);
  useLayoutEffect(() => {
    if (wasDictating.current && !dictating) {
      editorRef.current?.focusAt(anchor.current);
    }
    wasDictating.current = dictating;
  }, [dictating]);

  // Stopping hands the control back at once; draining the last words carries
  // on without holding the button.
  const listening = dictating && !dictation.stopping;
  function toggleDictation() {
    if (dictation.stopping) return;
    if (listening) {
      void stopDictation();
      return;
    }
    if (dictation.needsKey) {
      setKeyDialogOpen(true);
      return;
    }
    startDictation();
  }

  async function handleConflict() {
    const preConflictBaseText =
      conflictRef.current?.baseText ?? savedText.current;
    const preConflictBaseUpdatedAt = savedUpdatedAt.current ?? "";
    const fresh = await fetchTodayPocketNote(client, queryClient, tenantId);
    const serverText = fresh.note?.text ?? "";
    const serverUpdatedAt = pocketNoteExpectedUpdatedAt(fresh.note) ?? "";
    if (serverText === textRef.current) {
      lastFailedTextRef.current = undefined;
      setSavedBaseline(serverText, serverUpdatedAt);
      setRestoredDraftState(false);
      setConflictState(undefined);
      setConfirmingDiscard(false);
      setStorageUnavailable(false);
      save.reset();
      if (scope) clearPocketNoteDraft(scope);
      return;
    }
    setConflictState({
      baseText: preConflictBaseText,
      serverText,
      serverUpdatedAt,
    });
    setRestoredDraftState(false);
    setConfirmingDiscard(false);
    if (scope) {
      // Keep the pre-conflict base so reloading before resolution still detects
      // the server divergence.
      const persisted = writePocketNoteDraft(scope, {
        baseText: preConflictBaseText,
        baseUpdatedAt: preConflictBaseUpdatedAt,
        text: textRef.current,
        updatedAt: new Date().toISOString(),
      });
      setStorageUnavailable(!persisted);
    }
  }

  function ensureSaved(options?: {
    overrideExpectedUpdatedAt?: string;
  }): Promise<void> {
    if (offlineLoad) {
      return Promise.reject(new Error("Pocket Notes are offline"));
    }
    if (
      conflictRef.current &&
      options?.overrideExpectedUpdatedAt === undefined
    ) {
      return Promise.reject(new Error("Pocket Note conflict requires choice"));
    }
    if (saving.current) return saving.current;
    // Only one full-text write may be in flight. Edits made while it saves
    // become the next write instead of racing the previous version.
    const pending = (async () => {
      let nextExpected = options?.overrideExpectedUpdatedAt;
      while (
        textRef.current !== savedText.current ||
        nextExpected !== undefined
      ) {
        const valueToSave = textRef.current;
        const expectedUpdatedAt =
          nextExpected !== undefined ? nextExpected : savedUpdatedAt.current;
        nextExpected = undefined;
        try {
          await save.mutateAsync({
            expectedUpdatedAt,
            text: valueToSave,
          });
        } catch (error) {
          lastFailedTextRef.current = valueToSave;
          if (isPocketNoteConflictError(error)) {
            await handleConflict().catch(() => {});
          }
          throw error;
        }
        if (conflictRef.current) return;
      }
    })();
    saving.current = pending;
    const settled = () => {
      saving.current = undefined;
    };
    void pending.then(settled, settled);
    return pending;
  }

  function beforeLeave() {
    if (offlineLoad || conflictRef.current) {
      return Promise.reject(new Error("Unsynced Pocket Note requires action"));
    }
    if (dictation.active) return stopDictation().then(() => ensureSaved());
    if (saving.current || textRef.current !== savedText.current) {
      return ensureSaved();
    }
  }

  function showAll() {
    const pending = beforeLeave();
    if (pending) void pending.then(onShowAll, () => {});
    else onShowAll();
  }

  function startDictation() {
    setTruncated(false);
    anchor.current = editorRef.current?.selectionStart() ?? anchor.current;
    blockStart.current = anchor.current;
    dictation.start();
  }

  function saveDraftNow() {
    if (offlineLoad) {
      if (!onRetryLoad || retryingOfflineLoad) return;
      setRetryingOfflineLoad(true);
      void onRetryLoad().finally(() => {
        setRetryingOfflineLoad(false);
      });
      return;
    }
    void ensureSaved().catch(() => {});
  }

  function discardLocalDraft() {
    if (scope) clearPocketNoteDraft(scope);
    lastFailedTextRef.current = undefined;
    setConfirmingDiscard(false);
    setRestoredDraftState(false);
    setStorageUnavailable(false);
    setConflictState(undefined);
    save.reset();
    if (offlineLoad) {
      onOfflineDraftDiscarded?.();
      return;
    }
    userEditedRef.current = false;
    setUserEdited(false);
    textRef.current = savedText.current;
    setText(savedText.current);
  }

  function resolveKeepMine() {
    const current = conflictRef.current;
    if (!current) return;
    lastFailedTextRef.current = undefined;
    setSavedBaseline(current.serverText, current.serverUpdatedAt);
    setConflictState(undefined);
    save.reset();
    void ensureSaved({
      overrideExpectedUpdatedAt: current.serverUpdatedAt,
    }).catch(() => {});
  }

  function resolveKeepServer() {
    const current = conflictRef.current;
    if (!current) return;
    lastFailedTextRef.current = undefined;
    setSavedBaseline(current.serverText, current.serverUpdatedAt);
    textRef.current = current.serverText;
    userEditedRef.current = false;
    setText(current.serverText);
    setUserEdited(false);
    setConflictState(undefined);
    setRestoredDraftState(false);
    setConfirmingDiscard(false);
    setStorageUnavailable(false);
    save.reset();
    if (scope) clearPocketNoteDraft(scope);
  }

  function resolveMergeBoth() {
    const current = conflictRef.current;
    if (!current) return;
    const merged = mergePocketNoteConflict({
      baseText: current.baseText,
      localText: textRef.current,
      maxLength: maximumNoteLength,
      serverText: current.serverText,
    });
    if (merged.truncated) setTruncated(true);
    lastFailedTextRef.current = undefined;
    setSavedBaseline(current.serverText, current.serverUpdatedAt);
    textRef.current = merged.text;
    userEditedRef.current = true;
    setText(merged.text);
    setUserEdited(true);
    setConflictState(undefined);
    save.reset();
    if (scope) {
      const persisted = writePocketNoteDraft(scope, {
        baseText: current.serverText,
        baseUpdatedAt: current.serverUpdatedAt,
        text: merged.text,
        updatedAt: new Date().toISOString(),
      });
      setStorageUnavailable(!persisted);
    }
    void ensureSaved({
      overrideExpectedUpdatedAt: current.serverUpdatedAt,
    }).catch(() => {});
  }

  const unsaved = offlineLoad || text !== savedTextState;
  const saveFailed = !conflict && save.isError && unsaved;
  const showUnsyncedBar =
    !conflict && (offlineLoad || (unsaved && (restoredDraft || saveFailed)));
  const status = dictation.error
    ? dictation.error
    : truncated
      ? t(m.pageFull, {
          limit: maximumNoteLength.toLocaleString(formatLocale()),
        })
      : dictation.connecting
        ? t(m.connecting)
        : dictation.stopping
          ? t(m.saving)
          : dictating
            ? t(m.listening)
            : conflict
              ? t(m.conflictStatus)
              : saveFailed
                ? t(m.couldNotSave)
                : offlineLoad || (restoredDraft && !save.isPending && unsaved)
                  ? t(m.unsyncedLocalDraft)
                  : save.isPending || unsaved
                    ? t(m.saving)
                    : t(m.saved);
  // While speaking, the words still being recognized sit at the anchor.
  const at = Math.min(anchor.current, text.length);
  const before = text.slice(0, at);
  const live = dictation.liveText.trim();
  const after = text.slice(at);

  return (
    <>
      <PocketNoteHeader
        action={
          <>
            {saveFailed ? (
              <Button
                aria-label={t(m.retrySavingNote)}
                onClick={() => void ensureSaved().catch(() => {})}
                size="compact"
                tone="secondary"
              >
                {t(commonMessages.retry)}
              </Button>
            ) : null}
            <PocketNoteCopyAction text={text} />
          </>
        }
        leading={
          <HeaderButton label={t(m.allNotes)} onClick={showAll}>
            <Icon icon={GridViewIcon} size={16} />
          </HeaderButton>
        }
        onClose={onClose}
        subtitle={status}
        title={t(m.todayTitle, { date: formatPocketNoteDate(today) })}
      />
      {conflict ? (
        <PocketNoteConflictBar
          conflict={conflict}
          onKeepMine={resolveKeepMine}
          onKeepServer={resolveKeepServer}
          onMergeBoth={resolveMergeBoth}
          saving={save.isPending}
        />
      ) : showUnsyncedBar ? (
        <PocketNoteUnsyncedDraftBar
          confirmingDiscard={confirmingDiscard}
          onCancelDiscard={() => setConfirmingDiscard(false)}
          onConfirmDiscard={discardLocalDraft}
          onRequestDiscard={() => setConfirmingDiscard(true)}
          onSaveNow={saveDraftNow}
          saving={save.isPending || retryingOfflineLoad}
          showSaveAction={offlineLoad || restoredDraft}
          storageUnavailable={storageUnavailable}
        />
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={
            earlier
              ? "workspace-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto"
              : "flex min-h-0 flex-1 flex-col"
          }
        >
          {dictating ? (
            // While speaking the page is a read-only view of the note with the
            // words not yet final shown in place, in gray.
            <div
              aria-label={t(m.todayNote)}
              aria-live="polite"
              className={`pocket-note-paper whitespace-pre-wrap break-words px-5 text-sm text-app-ink ${earlier ? "min-h-[240px] pb-5" : "workspace-scrollbar min-h-0 flex-1 overflow-y-auto pb-16"}`}
              role="textbox"
              aria-readonly="true"
            >
              {before}
              <span className="text-app-ink/40" ref={liveRef}>
                {live && before && !before.endsWith("\n") ? "\n" : ""}
                {live}
              </span>
              {after}
            </div>
          ) : (
            <PocketNoteEditor
              fitContent={Boolean(earlier)}
              maxLength={maximumNoteLength}
              onChange={update}
              onFull={() => setTruncated(true)}
              ref={editorRef}
              value={text}
            />
          )}
          {earlier ? (
            <section
              aria-label={formatPocketNoteDate(earlier.date)}
              className="pocket-note-paper break-words border-t border-border px-5 pb-16 pt-4 text-sm text-app-ink"
            >
              <h2 className="mb-2 text-xs font-medium text-app-muted">
                {formatPocketNoteDate(earlier.date)}
              </h2>
              <MessageMarkdown authorKind="agent" body={earlier.text} />
            </section>
          ) : null}
        </div>
        {dictation.available ? (
          <DictationButton
            active={listening}
            connecting={dictation.connecting}
            level={dictation.level}
            onClick={toggleDictation}
          />
        ) : null}
        {anotherMeRoomId && onOpenChat && !dictating ? (
          <TellAnotherMe
            note={text}
            onEnsureSaved={ensureSaved}
            onOpenChat={onOpenChat}
            roomId={anotherMeRoomId}
          />
        ) : null}
        {keyDialogOpen ? (
          <LazyVoiceKeyDialog
            onClose={() => setKeyDialogOpen(false)}
            onReady={() => {
              setKeyDialogOpen(false);
              startDictation();
            }}
            policy={dictation.policy}
            providers={["soniox"]}
            tenantId={tenantId}
          />
        ) : null}
      </div>
    </>
  );
}

/** A quiet round control; while listening a thin meter follows the voice. */
function DictationButton({
  active,
  connecting,
  level,
  onClick,
}: {
  active: boolean;
  connecting: boolean;
  level: number;
  onClick: () => void;
}) {
  const t = useT();
  const label = active ? t(m.stopDictation) : t(m.dictate);
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2">
      {active ? (
        <span
          aria-hidden="true"
          className={`pocket-dictation-meter ${connecting ? "pocket-dictation-meter-waiting" : ""}`}
          style={{ "--pocket-level": connecting ? 0 : level } as CSSProperties}
        >
          {meterBars.map((weight) => (
            <span key={weight} style={{ "--bar": weight } as CSSProperties} />
          ))}
        </span>
      ) : null}
      <button
        aria-label={label}
        aria-pressed={active}
        className={`pointer-events-auto relative flex size-9 items-center justify-center rounded-full shadow-md transition-[background-color,color,transform] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus disabled:pointer-events-none disabled:opacity-50 ${active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
        onClick={onClick}
        title={label}
        type="button"
      >
        {active ? (
          <Icon icon={StopIcon} size={12} />
        ) : (
          <Icon icon={Mic01Icon} size={16} />
        )}
      </button>
    </div>
  );
}

const meterBars = [0.55, 0.8, 1, 0.8, 0.55];

function PastPocketNote({
  note,
  onBack,
  onClose,
}: {
  note: TeamHubPocketNote;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <>
      <PocketNoteHeader
        leading={
          <HeaderButton label={t(m.backToAllNotes)} onClick={onBack}>
            <Icon icon={ArrowLeft01Icon} size={16} />
          </HeaderButton>
        }
        onClose={onClose}
        subtitle={t(m.readOnly)}
        title={formatPocketNoteDate(note.date)}
      />
      <div className="pocket-note-paper workspace-scrollbar min-h-0 flex-1 overflow-y-auto break-words px-5 pb-5 text-sm text-app-ink">
        <MessageMarkdown authorKind="agent" body={note.text} />
      </div>
    </>
  );
}

function AllPocketNotes({
  closeGuard,
  downloadFailed,
  downloading,
  hasMore,
  items,
  loadingMore,
  onClose,
  onDownloadAll,
  onDownloadNote,
  onLoadMore,
  onOpen,
  tenantId,
  today,
}: {
  closeGuard: RefObject<CloseGuard | undefined>;
  downloadFailed: boolean;
  downloading: boolean;
  hasMore: boolean;
  items: TeamHubPocketNote[];
  loadingMore: boolean;
  onClose: () => void;
  onDownloadAll: () => void;
  onDownloadNote: (note: TeamHubPocketNote) => void;
  onLoadMore: () => void;
  onOpen: (note: TeamHubPocketNote) => void;
  tenantId: string;
  today: string;
}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string>();
  // A past day can be deleted to tidy up; what Memory already took in stays.
  const remove = useMutation({
    // Hides a past day's page; today's page stays editable instead.
    mutationFn: (date: string) =>
      teamHubDone(
        client.api.DELETE("/v0/tenants/{tenantId}/me/pocket-notes/{noteDate}", {
          params: { path: { tenantId, noteDate: date } },
        }),
      ),
    onSuccess: (_, date) => {
      removePocketNote(queryClient, tenantId, date);
      setConfirming(undefined);
    },
  });
  const [query, setQuery] = useState("");
  useLayoutEffect(() => {
    closeGuard.current = {
      listening: () => false,
      onEscape: () => {
        if (confirming) {
          remove.reset();
          setConfirming(undefined);
          return true;
        }
        if (query.length > 0) {
          setQuery("");
          return true;
        }
        return false;
      },
      stop: async () => {},
    };
  });
  useLayoutEffect(
    () => () => {
      closeGuard.current = undefined;
    },
    [closeGuard],
  );
  const cards = items.some((item) => item.date === today)
    ? items
    : [{ date: today, text: "", updated_at: "" }, ...items];
  const search = searchPocketNotes(cards, query);

  const listRef = useRef<HTMLDivElement>(null);
  const todayCardRef = useRef<HTMLLIElement>(null);
  const [jumpOffered, setJumpOffered] = useState(false);
  const [todayMarked, setTodayMarked] = useState(false);
  const markTimer = useRef<number | undefined>(undefined);
  // Today's page is only worth jumping to once it has been written; the list
  // still shows an empty Today card before that.
  const hasTodayNote = items.some((item) => item.date === today);

  const measureJump = useEffectEvent(() => {
    setJumpOffered(
      hasTodayNote &&
        todayNoteOutOfView(
          listRef.current?.getBoundingClientRect(),
          todayCardRef.current?.getBoundingClientRect(),
        ),
    );
  });

  // The card moves as pages load and as the search filters, not only on
  // scroll, so the offer follows each render of the list.
  useLayoutEffect(() => {
    measureJump();
  }, [hasTodayNote, items, query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => measureJump();
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => () => window.clearTimeout(markTimer.current), []);

  /**
   * Brings today's page back into the list's view without touching the search,
   * the open page, or the stored notes; the card is marked just long enough to
   * be found.
   */
  function jumpToToday() {
    const card = todayCardRef.current;
    if (!card) return;
    card.scrollIntoView({ block: "nearest" });
    setJumpOffered(false);
    setTodayMarked(true);
    window.clearTimeout(markTimer.current);
    markTimer.current = window.setTimeout(
      () => setTodayMarked(false),
      todayMarkMs,
    );
  }

  return (
    <>
      <PocketNoteHeader
        action={
          <>
            {jumpOffered ? (
              <HeaderButton label={t(m.jumpToToday)} onClick={jumpToToday}>
                <Icon icon={ArrowUp01Icon} size={16} />
              </HeaderButton>
            ) : null}
            {items.length > 0 ? (
              <HeaderButton
                disabled={downloading || loadingMore}
                label={t(m.downloadAll)}
                onClick={onDownloadAll}
              >
                <Icon icon={Download01Icon} size={16} />
              </HeaderButton>
            ) : null}
          </>
        }
        onClose={onClose}
        subtitle={t(hasMore ? m.pageCountOrMore : m.pageCount, {
          count: items.length,
        })}
        title={t(m.allNotes)}
      />
      {downloadFailed ? (
        <p className="shrink-0 px-4 pb-2 text-xs text-app-danger" role="alert">
          {t(m.couldNotDownload)}
        </p>
      ) : null}
      <label className="mx-4 mb-2 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40 sm:h-8">
        <Icon icon={Search01Icon} size={14} />
        <input
          aria-label={t(m.searchNotes)}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(m.searchPlaceholder)}
          role="searchbox"
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label={t(m.clearNoteSearch)}
            className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus sm:size-5"
            onClick={() => setQuery("")}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        ) : null}
      </label>
      <div
        className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        data-pocket-notes-scroll=""
        ref={listRef}
      >
        {search.matched ? (
          <div className="flex flex-col gap-3">
            {groupPocketNotesByMonth(search.items).map((group, index) => (
              <section aria-label={group.label} key={`${group.key}-${index}`}>
                {/* In flow above its own cards, so a stuck heading never covers them. */}
                <h2 className="sticky top-0 z-10 bg-popover py-1.5 text-xs font-medium text-app-muted">
                  {group.label}
                </h2>
                <ul className="grid grid-cols-1 gap-2.5 min-[384px]:grid-cols-2">
                  {group.notes.map((note) => {
                    const label =
                      note.date === today
                        ? t(m.today)
                        : formatPocketNoteDate(note.date);
                    const preview = markdownPlainText(note.text);
                    return (
                      <li
                        className={cn(
                          "group relative",
                          note.date === today &&
                            todayMarked &&
                            "pocket-note-today-marked",
                        )}
                        data-pocket-note-today={
                          note.date === today ? "" : undefined
                        }
                        key={note.date}
                        ref={note.date === today ? todayCardRef : undefined}
                      >
                        <button
                          className="flex h-[118px] w-full flex-col rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-border-hover hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                          onClick={() => onOpen(note)}
                          type="button"
                        >
                          <span className="pr-12 text-xs font-medium text-app-ink">
                            {label}
                          </span>
                          <span className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-[18px] text-app-muted">
                            {preview ? (
                              <HighlightedText query={query} text={preview} />
                            ) : (
                              t(m.nothingWritten)
                            )}
                          </span>
                        </button>
                        {note.date === today ? null : confirming ===
                          note.date ? (
                          <div
                            aria-label={t(m.deletePageQuestion, {
                              page: label,
                            })}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-border bg-card/95 p-2"
                            role="alertdialog"
                          >
                            <p
                              className={`text-center text-xs ${remove.isError ? "text-app-danger" : "text-app-ink"}`}
                            >
                              {remove.isError
                                ? t(m.couldNotDelete)
                                : t(m.deleteThisNote)}
                            </p>
                            <div className="flex max-w-full items-center justify-center gap-1.5">
                              <Button
                                onClick={() => {
                                  remove.reset();
                                  setConfirming(undefined);
                                }}
                                size="compact"
                                tone="ghost"
                              >
                                {t(commonMessages.cancel)}
                              </Button>
                              <Button
                                data-voice-risk="never"
                                loading={remove.isPending}
                                onClick={() => remove.mutate(note.date)}
                                size="compact"
                                tone="danger"
                              >
                                {t(commonMessages.delete)}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                            <button
                              aria-label={t(m.downloadPage, { page: label })}
                              className={cn(
                                noteActionClass,
                                "hover:bg-accent hover:text-app-ink",
                              )}
                              disabled={downloading}
                              onClick={() => onDownloadNote(note)}
                              title={t(m.downloadNote)}
                              type="button"
                            >
                              <Icon icon={Download01Icon} size={14} />
                            </button>
                            <button
                              data-voice-risk="never"
                              aria-label={t(m.deletePage, { page: label })}
                              className={cn(
                                noteActionClass,
                                "hover:bg-accent hover:text-app-danger",
                              )}
                              onClick={() => {
                                remove.reset();
                                setConfirming(note.date);
                              }}
                              title={t(m.deleteNote)}
                              type="button"
                            >
                              <Icon icon={Delete02Icon} size={14} />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <p className="text-xs text-app-muted">
              {t(m.noNotesMatch, { query: query.trim() })}
            </p>
            <Button
              onClick={() => setQuery("")}
              size="compact"
              tone="secondary"
            >
              {t(m.clearSearch)}
            </Button>
          </div>
        )}
        {hasMore ? (
          <button
            className="mt-3 w-full rounded-full py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
            disabled={loadingMore}
            onClick={onLoadMore}
            type="button"
          >
            {loadingMore ? t(commonMessages.loading) : t(m.loadEarlier)}
          </button>
        ) : null}
      </div>
    </>
  );
}

function PocketNoteHeader({
  action,
  leading,
  onClose,
  subtitle,
  title,
}: {
  action?: ReactNode;
  leading?: ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">
      {leading}
      <div className={`min-w-0 flex-1 ${leading ? "" : "pl-2"}`}>
        <p className="truncate text-sm font-medium leading-5 text-app-ink">
          {title}
        </p>
        {subtitle ? (
          <p
            aria-live="polite"
            className="truncate text-xs leading-4 text-app-muted"
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {action}
      <HeaderButton data-voice-close label={t(m.closeNotes)} onClick={onClose}>
        <Icon icon={Cancel01Icon} size={16} />
      </HeaderButton>
    </div>
  );
}

function HeaderButton({
  children,
  disabled,
  label,
  onClick,
  "data-voice-close": closes,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  /** The button that closes the panel, for Voice Mode. */
  "data-voice-close"?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus disabled:pointer-events-none disabled:opacity-40 sm:size-8"
      data-voice-close={closes || undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Copies today's page as the person sees it and reports the clipboard's answer,
 * so a refused write never reads as success. Nothing is saved or requested.
 */
function PocketNoteCopyAction({ text }: { text: string }) {
  const t = useT();
  const value = pocketNoteCopyText(text);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copy() {
    window.clearTimeout(resetTimer.current);
    setFailed(false);
    setCopied(false);
    void writeClipboardText(value)
      .then(() => {
        setCopied(true);
        resetTimer.current = window.setTimeout(
          () => setCopied(false),
          copiedFeedbackMs,
        );
      })
      .catch(() => setFailed(true));
  }

  return (
    <>
      {copied ? (
        <span
          className="min-w-0 max-w-20 truncate text-xs leading-4 text-app-muted"
          role="status"
        >
          {t(commonMessages.copied)}
        </span>
      ) : null}
      {failed ? (
        <span
          className="min-w-0 max-w-20 truncate text-xs leading-4 text-app-danger"
          role="alert"
        >
          {t(m.copyFailed)}
        </span>
      ) : null}
      <HeaderButton disabled={!value} label={t(m.copyNote)} onClick={copy}>
        <Icon icon={Copy01Icon} size={16} />
      </HeaderButton>
    </>
  );
}

function viewportDimensions() {
  const clientWidth = document.documentElement.clientWidth;
  const layoutWidth =
    clientWidth > 0
      ? Math.min(window.innerWidth, clientWidth)
      : window.innerWidth;
  const visualViewport = window.visualViewport;
  const width = visualViewport
    ? Math.min(layoutWidth, Math.floor(visualViewport.width))
    : layoutWidth;
  const height = visualViewport
    ? Math.min(window.innerHeight, Math.floor(visualViewport.height))
    : window.innerHeight;
  return { height, width };
}

function isRectVisible(rect: DOMRect | undefined): rect is DOMRect {
  return Boolean(rect && (rect.width > 0 || rect.height > 0));
}

/** Opens beneath its trigger over the sidebar column so the chat stays readable. */
function usePanelPosition(anchor: HTMLButtonElement | null): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({
    height: panelHeight,
    left: panelGap,
    top: panelGap,
    width: panelWidth,
  });
  useLayoutEffect(() => {
    function place() {
      const { height: viewportHeight, width: viewportWidth } =
        viewportDimensions();
      const width = Math.min(
        panelWidth,
        Math.max(0, viewportWidth - panelGap * 2),
      );
      const height =
        viewportHeight > 0
          ? Math.min(panelHeight, Math.max(0, viewportHeight - panelGap * 2))
          : panelHeight;
      const centeredLeft = Math.max(
        panelGap,
        Math.min(
          Math.round((viewportWidth - width) / 2),
          viewportWidth - width - panelGap,
        ),
      );
      const narrow = viewportWidth < narrowBackdropMaxWidth;
      const sidebar = anchor
        ?.closest(".app-secondary-navigation")
        ?.getBoundingClientRect();
      const trigger = anchor?.getBoundingClientRect();
      let next: CSSProperties;
      if (!anchor) {
        // The room that opened the note has gone; keep the page on screen.
        next = {
          height,
          left: narrow ? centeredLeft : panelGap,
          top: narrow
            ? panelGap
            : Math.max(panelGap, viewportHeight - height - panelGap),
          width,
        };
      } else if (!isRectVisible(trigger)) {
        // The trigger is hidden inside a closed mobile drawer or collapsed rail.
        next = {
          height,
          left: narrow ? centeredLeft : panelGap,
          top: panelGap,
          width,
        };
      } else {
        const preferredLeft = isRectVisible(sidebar)
          ? sidebar.left
          : trigger.left;
        const left = Math.max(
          panelGap,
          Math.min(preferredLeft, viewportWidth - width - panelGap),
        );
        const top = Math.max(
          panelGap,
          Math.min(trigger.bottom + 8, viewportHeight - height - panelGap),
        );
        next = { height, left, top, width };
      }
      setPosition((current) =>
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      );
    }

    let frame: number | undefined;
    const schedulePlace = () => {
      place();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      // Re-measure after breakpoint-driven drawer visibility commits.
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        place();
      });
    };

    place();
    window.addEventListener("resize", schedulePlace);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", schedulePlace);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && anchor) {
      observer = new ResizeObserver(place);
      observer.observe(anchor);
      const sidebar = anchor.closest(".app-secondary-navigation");
      if (sidebar && sidebar !== anchor) observer.observe(sidebar);
    }
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePlace);
      visualViewport?.removeEventListener("resize", schedulePlace);
      observer?.disconnect();
    };
  }, [anchor]);
  return position;
}

/** "2026-09-30" -> "Sep 30"; TeamHub already chose the page day. */
function formatPocketNoteDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(formatLocale(), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}
