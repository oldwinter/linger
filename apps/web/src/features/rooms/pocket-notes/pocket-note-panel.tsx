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

import { teamHubData, teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

import { Button } from "@/components/ui/button";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";

import {
  pocketNotesQueryOptions,
  removePocketNote,
  storeTodayPocketNote,
} from "./pocket-note-queries";
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
const panelGap = 12;
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
  anchor,
  anotherMeRoomId,
  closeRef,
  onClose,
  onOpenChat,
  tenantId,
}: {
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
  const { client } = useTeamHubRuntime();
  const notes = useInfiniteQuery(pocketNotesQueryOptions(client, tenantId));
  const [view, setView] = useState<PocketNoteView>({ kind: "today" });
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
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

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
    <div
      aria-label="Pocket notes"
      className="app-floating-enter fixed z-[100] flex h-[440px] max-h-[calc(100dvh-24px)] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl bg-popover shadow-xl"
      ref={panelRef}
      role="dialog"
      style={{ ...position, width: panelWidth }}
    >
      {!firstPage || !today ? (
        notes.isError ? (
          <div
            className="m-auto flex flex-col items-center gap-2.5 px-4 text-center"
            role="alert"
          >
            <p className="text-sm text-app-muted">Couldn’t load notes</p>
            <Button
              onClick={() => void notes.refetch()}
              size="compact"
              tone="secondary"
            >
              Retry
            </Button>
          </div>
        ) : (
          <p className="m-auto text-sm text-app-muted">Loading…</p>
        )
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
              note.date === today ? { kind: "today" } : { kind: "past", note },
            )
          }
          tenantId={tenantId}
          today={today}
        />
      ) : view.kind === "today" ? (
        <TodayPocketNote
          anotherMeRoomId={anotherMeRoomId}
          closeGuard={closeGuard}
          earlier={pocketNoteBefore(items, today)}
          key={`${tenantId}:${today}`}
          onClose={() => void close()}
          onOpenChat={onOpenChat}
          onShowAll={() => setView({ kind: "all" })}
          storedText={todayNote?.text ?? ""}
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
    </div>,
    document.body,
  );
}

function TodayPocketNote({
  anotherMeRoomId,
  closeGuard,
  earlier,
  onClose,
  onOpenChat,
  onShowAll,
  storedText,
  tenantId,
  today,
}: {
  anotherMeRoomId?: string;
  closeGuard: RefObject<CloseGuard | undefined>;
  /** The newest written page before today, read on the same paper. */
  earlier?: TeamHubPocketNote;
  /** Today's saved text, which a save from elsewhere can change underneath. */
  storedText: string;
  onClose: () => void;
  onOpenChat?: () => void;
  onShowAll: () => void;
  tenantId: string;
  today: string;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [text, setText] = useState(storedText);
  const textRef = useRef(storedText);
  const savedText = useRef(storedText);
  const storedRef = useRef(storedText);
  const saving = useRef<Promise<void> | undefined>(undefined);
  const editorRef = useRef<PocketNoteEditorHandle>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const anchor = useRef(0);
  // Where this dictation began; later turns continue its paragraph.
  const blockStart = useRef(0);
  const [truncated, setTruncated] = useState(false);
  const save = useMutation({
    mutationFn: (value: string) =>
      teamHubData(
        client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
          params: { path: { tenantId } },
          body: { text: value },
        }),
      ),
    onSuccess: (note) => {
      savedText.current = note.text;
      storedRef.current = note.text;
      storeTodayPocketNote(queryClient, tenantId, note);
    },
  });
  const persist = useEffectEvent(() => {
    void ensureSaved().catch(() => {});
  });

  function update(value: string) {
    textRef.current = value;
    setText(value);
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
      stop: stopDictation,
    };
    return () => {
      closeGuard.current = undefined;
    };
  });

  // A save from the Message menu writes the same page. With nothing unsaved
  // the editor takes the new text; with a draft it keeps the person's words and
  // gains only the appended block, so the next autosave carries both.
  useEffect(() => {
    if (storedText === storedRef.current) return;
    const previous = storedRef.current;
    storedRef.current = storedText;
    if (textRef.current === savedText.current) {
      savedText.current = storedText;
      textRef.current = storedText;
      setText(storedText);
      return;
    }
    if (!storedText.startsWith(previous)) return;
    const merged = appendToPocketNote(
      textRef.current,
      storedText.slice(previous.length),
    );
    textRef.current = merged;
    setText(merged);
  }, [storedText]);

  useEffect(() => {
    if (text === savedText.current) return;
    const timer = window.setTimeout(() => persist(), autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [text]);

  // Closing the notepad inside the autosave delay must not drop the last words.
  useEffect(
    () => () => {
      if (textRef.current !== savedText.current) {
        persist();
      }
    },
    [],
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
  function ensureSaved(): Promise<void> {
    if (saving.current) return saving.current;
    // Only one full-text write may be in flight. Edits made while it saves
    // become the next write instead of racing the previous version.
    const pending = (async () => {
      while (textRef.current !== savedText.current) {
        await save.mutateAsync(textRef.current);
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
    if (dictation.active) return stopDictation().then(ensureSaved);
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

  const unsaved = text !== savedText.current;
  const saveFailed = save.isError && unsaved;
  const status = dictation.error
    ? dictation.error
    : truncated
      ? "Page is full · 20,000 characters"
      : dictation.connecting
        ? "Connecting…"
        : dictation.stopping
          ? "Saving…"
          : dictating
            ? "Listening…"
            : saveFailed
              ? "Couldn’t save"
              : save.isPending || unsaved
                ? "Saving…"
                : "Saved";
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
                aria-label="Retry saving note"
                onClick={() => void ensureSaved().catch(() => {})}
                size="compact"
                tone="secondary"
              >
                Retry
              </Button>
            ) : null}
            <PocketNoteCopyAction text={text} />
          </>
        }
        leading={
          <HeaderButton label="All notes" onClick={showAll}>
            <Icon icon={GridViewIcon} size={16} />
          </HeaderButton>
        }
        onClose={onClose}
        subtitle={status}
        title={`Today · ${formatPocketNoteDate(today)}`}
      />
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
              aria-label="Today’s note"
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
  const label = active ? "Stop dictation" : "Dictate";
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
  return (
    <>
      <PocketNoteHeader
        leading={
          <HeaderButton label="Back to all notes" onClick={onBack}>
            <Icon icon={ArrowLeft01Icon} size={16} />
          </HeaderButton>
        }
        onClose={onClose}
        subtitle="Read only"
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
              <HeaderButton label="Jump to today" onClick={jumpToToday}>
                <Icon icon={ArrowUp01Icon} size={16} />
              </HeaderButton>
            ) : null}
            {items.length > 0 ? (
              <HeaderButton
                disabled={downloading || loadingMore}
                label="Download all"
                onClick={onDownloadAll}
              >
                <Icon icon={Download01Icon} size={16} />
              </HeaderButton>
            ) : null}
          </>
        }
        onClose={onClose}
        subtitle={`${items.length}${hasMore ? "+" : ""} ${items.length === 1 && !hasMore ? "page" : "pages"}`}
        title="All notes"
      />
      {downloadFailed ? (
        <p className="shrink-0 px-4 pb-2 text-xs text-app-danger" role="alert">
          Couldn’t download notes. Try again.
        </p>
      ) : null}
      <label className="mx-4 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40">
        <Icon icon={Search01Icon} size={14} />
        <input
          aria-label="Search notes"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by date or text"
          role="searchbox"
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label="Clear note search"
            className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
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
                <ul className="grid grid-cols-2 gap-2.5">
                  {group.notes.map((note) => {
                    const label =
                      note.date === today
                        ? "Today"
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
                              "Nothing written yet"
                            )}
                          </span>
                        </button>
                        {note.date === today ? null : confirming ===
                          note.date ? (
                          <div
                            aria-label={`Delete ${label}?`}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card/95 p-3"
                            role="alertdialog"
                          >
                            <p
                              className={`text-center text-xs ${remove.isError ? "text-app-danger" : "text-app-ink"}`}
                            >
                              {remove.isError
                                ? "Couldn’t delete. Try again."
                                : "Delete this note?"}
                            </p>
                            <div className="flex gap-1.5">
                              <Button
                                onClick={() => {
                                  remove.reset();
                                  setConfirming(undefined);
                                }}
                                size="compact"
                                tone="ghost"
                              >
                                Cancel
                              </Button>
                              <Button
                                loading={remove.isPending}
                                onClick={() => remove.mutate(note.date)}
                                size="compact"
                                tone="danger"
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                            <button
                              aria-label={`Download ${label}`}
                              className={cn(
                                noteActionClass,
                                "hover:bg-accent hover:text-app-ink",
                              )}
                              disabled={downloading}
                              onClick={() => onDownloadNote(note)}
                              title="Download note"
                              type="button"
                            >
                              <Icon icon={Download01Icon} size={14} />
                            </button>
                            <button
                              aria-label={`Delete ${label}`}
                              className={cn(
                                noteActionClass,
                                "hover:bg-accent hover:text-app-danger",
                              )}
                              onClick={() => {
                                remove.reset();
                                setConfirming(note.date);
                              }}
                              title="Delete note"
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
              No notes match “{query.trim()}”.
            </p>
            <Button
              onClick={() => setQuery("")}
              size="compact"
              tone="secondary"
            >
              Clear search
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
            {loadingMore ? "Loading…" : "Load earlier notes"}
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
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">
      {leading}
      <div className={`min-w-0 flex-1 ${leading ? "" : "pl-2"}`}>
        <p className="truncate text-sm font-medium leading-5 text-app-ink">
          {title}
        </p>
        <p
          aria-live="polite"
          className="truncate text-xs leading-4 text-app-muted"
        >
          {subtitle}
        </p>
      </div>
      {action}
      <HeaderButton label="Close notes" onClick={onClose}>
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
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus disabled:pointer-events-none disabled:opacity-40"
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
        <span className="text-xs leading-4 text-app-muted" role="status">
          Copied
        </span>
      ) : null}
      {failed ? (
        <span className="text-xs leading-4 text-app-danger" role="alert">
          Copy failed
        </span>
      ) : null}
      <HeaderButton disabled={!value} label="Copy note" onClick={copy}>
        <Icon icon={Copy01Icon} size={16} />
      </HeaderButton>
    </>
  );
}

/** Opens beside the sidebar row and stays inside the viewport. */
function usePanelPosition(anchor: HTMLButtonElement | null): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({
    left: panelGap,
    top: panelGap,
  });
  useLayoutEffect(() => {
    function place() {
      const height = 440;
      const column = anchor?.closest(".app-secondary-navigation");
      const beside = (column ?? anchor)?.getBoundingClientRect();
      const trigger = anchor?.getBoundingClientRect();
      // The room that opened the note has gone; keep the page on screen.
      if (!beside || !trigger) {
        setPosition({
          left: panelGap,
          top: Math.max(panelGap, window.innerHeight - height - panelGap),
        });
        return;
      }
      const left = Math.min(
        beside.right + panelGap,
        window.innerWidth - panelWidth - panelGap,
      );
      const top = Math.max(
        panelGap,
        Math.min(trigger.top - 24, window.innerHeight - height - panelGap),
      );
      setPosition({ left: Math.max(panelGap, left), top });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  return position;
}

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-09-30" -> "Sep 30"; TeamHub already chose the page day. */
function formatPocketNoteDate(date: string) {
  const [, month, day] = date.split("-");
  return `${monthNames[Number(month) - 1]} ${Number(day)}`;
}
