import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { ReadOnlyBlockNoteDocumentLoader } from "@/components/read-only-blocknote-document-loader";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useQuery } from "@tanstack/react-query";
import { ArtifactContentRendererLoader } from "@/features/rooms/files/artifact-content-renderer-loader";
import {
  downloadArtifactPreview,
  loadArtifactPreview,
  triggerArtifactDownload,
  type LoadedArtifactPreview,
} from "@/features/rooms/files/artifact-preview-loader";
import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { MeetingAudioPlayer } from "./meeting-audio-player";
import { parseMeetingSummary } from "./meeting-overview";
import {
  MeetingKeywords,
  MeetingOutcomes,
  MeetingOverviewCard,
} from "./meeting-overview-card";
import { HideMeetingDialog } from "./hide-meeting-dialog";
import {
  formatMeetingWhen,
  meetingTitle,
  meetingWhen,
} from "./meetings-calendar";
import { meetingPath } from "./meeting-routes";
import { MeetingShareAction } from "./meeting-share-action";
import {
  applyMeetingTranscriptMarks,
  scrollMeetingTranscriptTurn,
} from "./meeting-transcript-highlight";
import {
  nextMatchPosition,
  previousMatchPosition,
  searchMeetingTranscript,
} from "./meeting-transcript-search";
import {
  meetingTranscriptText,
  meetingTranscriptTurns,
} from "./meeting-transcript-text";
import { useMeetingActionTrack } from "./use-meeting-action-track";

const meetingSummaryHiddenSectionTitles = [
  "CRM Evidence Cache",
  "Workflow Evidence Cache",
  "Runtime Evidence",
  "Subject Relation Note",
] as const;

/** Long enough to read, matching the message menu's Copied tick. */
const LINK_COPIED_MS = 1200;

export type MeetingTab = "summary" | "transcript";

/**
 * One page per meeting: Summary and Transcript share the reading area as two
 * tabs, and the recording player closes the Summary tab. Summary opens first
 * once it exists; until then the transcript is shown.
 */
export function MeetingReader({
  entry,
  file,
  onHidden,
  onSelectTab,
  resolveLink,
  tenantId,
}: {
  entry: TeamHubMemoryEntry;
  /** The `file` URL parameter; "recording" and none choose the default tab. */
  file: string | null;
  /** Leaves the page once the meeting is deleted from the reader's Meetings. */
  onHidden: () => void;
  onSelectTab: (tab: MeetingTab) => void;
  resolveLink?: (reference: string) => string | null | undefined;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const meeting = entry.meeting!;
  // The shell already cached this identity, so the reader adds no request; the
  // listening position belongs to the signed-in Account.
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const accountId = identity.data?.account.id;
  const [deleting, setDeleting] = useState(false);
  const tab: MeetingTab =
    file === "summary" || file === "transcript"
      ? file
      : meeting.summary_ready
        ? "summary"
        : "transcript";
  const when = meetingWhen(entry.path);
  const title = meetingTitle(entry);
  const trackAction = useMeetingActionTrack({
    meetingId: entry.id,
    meetingTitle: title,
    tenantId,
  });
  // Link feedback follows the meeting showing now; switching meetings drops it
  // with the old entry.
  const [linkCopy, setLinkCopy] = useState<{
    entryId: string;
    state: "copied" | "failed";
  }>();
  const linkCopyTimer = useRef<number | undefined>(undefined);
  const summaryCopyTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(linkCopyTimer.current);
      window.clearTimeout(summaryCopyTimer.current);
    },
    [],
  );
  function copyLink() {
    window.clearTimeout(linkCopyTimer.current);
    setLinkCopy(undefined);
    void import("@/lib/clipboard")
      .then(({ writeClipboardText }) =>
        writeClipboardText(
          new URL(
            meetingPath(tenantId, entry.id),
            window.location.origin,
          ).toString(),
        ),
      )
      .then(() => {
        setLinkCopy({ entryId: entry.id, state: "copied" });
        linkCopyTimer.current = window.setTimeout(
          () => setLinkCopy(undefined),
          LINK_COPIED_MS,
        );
      })
      .catch(() => setLinkCopy({ entryId: entry.id, state: "failed" }));
  }
  const linkCopyState =
    linkCopy?.entryId === entry.id ? linkCopy.state : undefined;
  // Copy feedback belongs to the section that raised it and to the meeting
  // showing now; switching meetings drops it with the old entry.
  const [actionsCopy, setActionsCopy] = useState<{
    entryId: string;
    index: number;
    state: "copied" | "failed";
  }>();
  // The summary's feedback follows the meeting showing now, as the link's does.
  const [summaryCopy, setSummaryCopy] = useState<{
    entryId: string;
    state: "copied" | "failed";
  }>();
  async function copyActions(index: number, checklist: string) {
    try {
      await navigator.clipboard.writeText(checklist);
      setActionsCopy({ entryId: entry.id, index, state: "copied" });
    } catch {
      setActionsCopy({ entryId: entry.id, index, state: "failed" });
    }
  }
  const summaryMarkdown = useMemo(
    () => entry.content.replace(/^#[ \t]+[^\n]*\n?/mu, ""),
    [entry.content],
  );
  const summaryCopyState =
    summaryCopy?.entryId === entry.id ? summaryCopy.state : undefined;
  // Copies the Markdown the summary is rendered from, never a second reading
  // of `entry.content`, so the clipboard says what the view shows.
  function copySummary() {
    window.clearTimeout(summaryCopyTimer.current);
    setSummaryCopy(undefined);
    void import("@/lib/clipboard")
      .then(({ writeClipboardText }) => writeClipboardText(summaryMarkdown))
      .then(() => {
        setSummaryCopy({ entryId: entry.id, state: "copied" });
        summaryCopyTimer.current = window.setTimeout(
          () => setSummaryCopy(undefined),
          LINK_COPIED_MS,
        );
      })
      .catch(() => setSummaryCopy({ entryId: entry.id, state: "failed" }));
  }
  // Keywords, Meeting Summary topics and the outcome lists are shown in
  // place; the rest stays the knowledge document around them.
  const blocks = useMemo(
    () => parseMeetingSummary(summaryMarkdown),
    [summaryMarkdown],
  );
  const summaryDocument = (markdown: string) => (
    <ReadOnlyBlockNoteDocumentLoader
      ariaLabel="Meeting summary document"
      hiddenSectionTitles={meetingSummaryHiddenSectionTitles}
      markdown={markdown}
      presentation="knowledge"
      resolveLink={resolveLink}
    />
  );
  const tabs: Array<{ id: MeetingTab; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "transcript", label: "Transcript" },
  ];
  return (
    <article
      aria-label="Meeting"
      className="meeting-document mx-auto w-full max-w-4xl px-5 py-7 md:px-10"
      data-meeting-surface
    >
      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-xl text-app-ink">{title}</h2>
          <p className="mt-1 text-xs text-app-muted">Read only</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {linkCopyState === "copied" ? (
            <span className="text-xs leading-4 text-app-muted" role="status">
              Copied
            </span>
          ) : null}
          {linkCopyState === "failed" ? (
            <span className="text-xs leading-4 text-app-danger" role="alert">
              Copy failed
            </span>
          ) : null}
          <Button onClick={copyLink} size="compact" tone="ghost">
            Copy link
          </Button>
          {meeting.summary_ready ? (
            <MeetingShareAction
              entry={entry}
              key={entry.id}
              tenantId={tenantId}
            />
          ) : null}
          <Button onClick={() => setDeleting(true)} size="compact" tone="ghost">
            Delete
          </Button>
        </div>
      </header>
      {deleting ? (
        <HideMeetingDialog
          captureId={meeting.capture_id}
          name={
            when
              ? `Meeting ${formatMeetingWhen(when.date, when.time)}`
              : entry.title
          }
          onClose={() => setDeleting(false)}
          onHidden={onHidden}
          tenantId={tenantId}
        />
      ) : null}
      <div
        aria-label="Meeting views"
        className="flex items-center gap-1 border-b border-app-border"
        role="tablist"
      >
        {tabs.map((item) => (
          <button
            aria-controls={`meeting-${item.id}`}
            aria-selected={tab === item.id}
            className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus ${
              tab === item.id
                ? "border-app-ink text-app-ink"
                : "border-transparent text-app-muted hover:text-app-ink"
            }`}
            id={`meeting-tab-${item.id}`}
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`meeting-tab-${tab}`}
        className="pt-5"
        id={`meeting-${tab}`}
        role="tabpanel"
      >
        {tab === "summary" ? (
          <>
            {meeting.summary_ready ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                  {summaryCopyState === "copied" ? (
                    <span
                      className="text-xs leading-4 text-app-muted"
                      role="status"
                    >
                      Copied
                    </span>
                  ) : null}
                  {summaryCopyState === "failed" ? (
                    <span
                      className="text-xs leading-4 text-app-danger"
                      role="alert"
                    >
                      Copy failed
                    </span>
                  ) : null}
                  {summaryMarkdown.trim() ? (
                    <Button
                      onClick={copySummary}
                      size="compact"
                      tone="secondary"
                    >
                      Copy summary
                    </Button>
                  ) : null}
                  <Button
                    size="compact"
                    tone="secondary"
                    onClick={() =>
                      triggerArtifactDownload(
                        new Blob([entry.content], {
                          type: "text/markdown;charset=utf-8",
                        }),
                        "summary.md",
                      )
                    }
                  >
                    Download summary
                  </Button>
                </div>
                {/* One reading surface: the table of contents reads every
                    heading inside it, the card's included. */}
                <article
                  aria-label="Meeting summary"
                  className="[&>article:not(:first-child)]:pt-0 [&>article:not(:last-child)]:pb-0"
                  data-content-renderer="blocknote"
                  data-editable="false"
                >
                  {blocks.map((block, index) =>
                    block.kind === "markdown" ? (
                      <Fragment key={index}>
                        {summaryDocument(block.markdown)}
                      </Fragment>
                    ) : block.kind === "keywords" ? (
                      <MeetingKeywords
                        key={index}
                        keywords={block.keywords}
                        title={block.title}
                      />
                    ) : block.kind === "topics" ? (
                      <MeetingOverviewCard key={index} topics={block.topics} />
                    ) : (
                      <MeetingOutcomes
                        copyStatus={
                          actionsCopy?.entryId === entry.id &&
                          actionsCopy.index === index
                            ? actionsCopy.state
                            : undefined
                        }
                        key={index}
                        onCopyActions={(checklist) =>
                          void copyActions(index, checklist)
                        }
                        onTrack={trackAction}
                        outcomes={block.outcomes}
                        title={block.title}
                      />
                    ),
                  )}
                </article>
              </>
            ) : (
              <p className="text-sm text-app-muted" role="status">
                The summary is still being written. The transcript is ready now.
              </p>
            )}
            {/* The recording closes the summary, ready to replay a moment. */}
            <div className="mt-8">
              <MeetingVersionReader
                key={meeting.recording_version_id}
                accountId={accountId}
                documentId={meeting.recording_document_id}
                filename={meeting.recording_filename}
                meetingId={entry.id}
                variant="player"
                versionId={meeting.recording_version_id}
              />
            </div>
          </>
        ) : (
          <MeetingVersionReader
            key={meeting.transcript_version_id}
            documentId={meeting.transcript_document_id}
            versionId={meeting.transcript_version_id}
            filename="transcript.md"
            variant="document"
          />
        )}
      </div>
    </article>
  );
}

/**
 * A meeting file read from its exact Version: the recording as a player row,
 * the transcript as the tab's document, each with its own download.
 */
function MeetingVersionReader({
  accountId,
  documentId,
  versionId,
  filename,
  meetingId,
  variant,
}: {
  /** Whose listening positions the player remembers. */
  accountId?: string;
  documentId: string;
  versionId: string;
  filename: string;
  /** Tells the player which meeting it is playing, so its speed starts over. */
  meetingId?: string;
  variant: "player" | "document";
}) {
  const { client } = useTeamHubRuntime();
  const [preview, setPreview] = useState<LoadedArtifactPreview>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  // Copying needs the transcript's text, not just its Version metadata; the
  // Download control takes the raw body instead.
  const transcriptText =
    variant === "document" ? preview?.textContent : undefined;
  const transcriptRoot = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(0);
  const turns = useMemo(
    () => (transcriptText ? meetingTranscriptTurns(transcriptText) : []),
    [transcriptText],
  );
  const match = useMemo(
    () => searchMeetingTranscript(turns, query),
    [query, turns],
  );
  const searching = query.trim() !== "";
  // A new query starts at its first match; a shorter result list clamps a
  // position left over from the previous query.
  const current = match.count ? Math.min(position, match.count - 1) : 0;
  useEffect(() => setPosition(0), [query]);
  useEffect(() => {
    if (!searching || !match.count) return;
    const root = transcriptRoot.current;
    if (!root) return;
    let cleanup = () => {};
    const apply = () => {
      cleanup();
      cleanup = applyMeetingTranscriptMarks({
        current,
        match,
        root,
        turns,
      });
    };
    apply();
    // The document renders lazily, so the marks follow its blocks appearing.
    const observer = new MutationObserver(apply);
    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      cleanup();
    };
  }, [current, match, searching, turns]);
  const currentTurn = match.count ? match.indices[current] : undefined;
  useEffect(() => {
    if (!searching || currentTurn === undefined) return;
    const root = transcriptRoot.current;
    if (!root) return;
    const frame = requestAnimationFrame(() =>
      scrollMeetingTranscriptTurn(root, currentTurn, turns.length),
    );
    return () => cancelAnimationFrame(frame);
  }, [currentTurn, searching, turns.length]);
  const [copyState, setCopyState] = useState<"copied" | "failed">();
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  function copyTranscript() {
    if (!transcriptText) return;
    window.clearTimeout(copyTimer.current);
    setCopyState(undefined);
    void import("@/lib/clipboard")
      .then(({ writeClipboardText }) =>
        writeClipboardText(meetingTranscriptText(transcriptText)),
      )
      .then(() => {
        setCopyState("copied");
        copyTimer.current = window.setTimeout(
          () => setCopyState(undefined),
          LINK_COPIED_MS,
        );
      })
      .catch(() => setCopyState("failed"));
  }
  const transfer = useRef<AbortController | null>(null);
  const siblingRetries = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    transfer.current = controller;
    let dispose: (() => void) | undefined;
    setPreview(undefined);
    setCopyState(undefined);
    setError(undefined);
    void loadArtifactPreview({
      client,
      documentId,
      versionId,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) {
          result.dispose();
          return;
        }
        dispose = result.dispose;
        setPreview(result);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        // The preview cache drops every load when another file is refused,
        // and the recording and transcript load side by side here. A load
        // cancelled by its sibling retries instead of showing an error.
        if (
          failure instanceof DOMException &&
          failure.name === "AbortError" &&
          siblingRetries.current < 2
        ) {
          siblingRetries.current += 1;
          setAttempt((value) => value + 1);
          return;
        }
        setError(
          failure instanceof Error ? failure.message : "File unavailable.",
        );
      });
    return () => {
      controller.abort();
      dispose?.();
    };
  }, [client, documentId, versionId, attempt]);
  async function download() {
    const signal = transfer.current?.signal;
    if (!preview || !signal || signal.aborted) return;
    setDownloading(true);
    try {
      triggerArtifactDownload(
        await downloadArtifactPreview({
          client,
          preview,
          signal,
        }),
        filename,
      );
    } catch (failure) {
      if (!signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "Download failed.",
        );
    } finally {
      if (!signal.aborted) setDownloading(false);
    }
  }
  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      {variant === "document" ? (
        <>
          {copyState === "copied" ? (
            <span className="text-xs leading-4 text-app-muted" role="status">
              Copied
            </span>
          ) : null}
          {copyState === "failed" ? (
            <span className="text-xs leading-4 text-app-danger" role="alert">
              Copy failed
            </span>
          ) : null}
          <Button
            disabled={!transcriptText}
            onClick={copyTranscript}
            size="compact"
            tone="secondary"
          >
            Copy transcript
          </Button>
        </>
      ) : null}
      <Button
        aria-label={`Download ${filename}`}
        size="compact"
        tone="secondary"
        disabled={!preview || downloading}
        onClick={() => void download()}
      >
        {variant === "player" ? "Download recording" : "Download transcript"}
      </Button>
    </div>
  );
  const body = error ? (
    <div className="text-sm text-app-danger" role="alert">
      {error}{" "}
      <Button
        onClick={() => setAttempt((value) => value + 1)}
        size="compact"
        tone="secondary"
      >
        Retry
      </Button>
    </div>
  ) : !preview ? (
    <p className="text-sm text-app-muted" role="status">
      {variant === "player" ? "Loading recording…" : "Loading transcript…"}
    </p>
  ) : preview.decision.kind === "download" ? (
    <p className="text-sm text-app-muted">
      Preview unavailable. Download the recording to open it.
    </p>
  ) : (
    <ArtifactContentRendererLoader
      kind={preview.decision.kind}
      filename={filename}
      mediaType={preview.version.media_type}
      blob={preview.blob}
      objectUrl={preview.objectUrl}
      previewUrl={preview.previewUrl}
      textContent={preview.textContent}
      sourceSizeBytes={preview.sourceSizeBytes}
      presentation="knowledge"
    />
  );
  const searchBar =
    variant === "document" ? (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40">
          <Icon icon={Search01Icon} size={14} />
          <input
            aria-label="Search transcript"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
            disabled={!transcriptText}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search transcript"
            role="searchbox"
            type="text"
            value={query}
          />
          {query ? (
            <button
              aria-label="Clear transcript search"
              className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
              onClick={() => setQuery("")}
              type="button"
            >
              <Icon icon={Cancel01Icon} size={12} />
            </button>
          ) : null}
        </label>
        {searching ? (
          <span className="text-xs tabular-nums text-app-muted" role="status">
            {match.count
              ? `${match.count} ${match.count === 1 ? "match" : "matches"}`
              : "No matches"}
          </span>
        ) : null}
        {searching && match.count ? (
          <span className="text-xs tabular-nums text-app-muted">
            {current + 1} of {match.count}
          </span>
        ) : null}
        <Button
          aria-label="Previous match"
          disabled={!match.count}
          onClick={() =>
            setPosition(previousMatchPosition(current, match.count))
          }
          size="compactIcon"
          tone="ghost"
        >
          <Icon icon={ArrowUp01Icon} size={14} />
        </Button>
        <Button
          aria-label="Next match"
          disabled={!match.count}
          onClick={() => setPosition(nextMatchPosition(current, match.count))}
          size="compactIcon"
          tone="ghost"
        >
          <Icon icon={ArrowDown01Icon} size={14} />
        </Button>
      </div>
    ) : null;
  if (variant === "player") {
    if (error)
      return (
        <section
          aria-label="Meeting recording"
          className="flex items-center gap-3 rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm"
        >
          <span className="min-w-0 flex-1 text-app-danger" role="alert">
            {error}
          </span>
          <Button
            onClick={() => setAttempt((value) => value + 1)}
            size="compact"
            tone="secondary"
          >
            Retry
          </Button>
        </section>
      );
    const playable =
      preview?.objectUrl &&
      preview.decision.kind === "media" &&
      preview.version.media_type.toLowerCase().startsWith("audio/");
    return (
      <MeetingAudioPlayer
        accountId={accountId}
        downloadDisabled={!preview || downloading}
        filename={filename}
        mediaType={preview?.version.media_type}
        meetingId={meetingId}
        onDownload={() => void download()}
        src={playable ? preview.objectUrl : undefined}
        status={
          !preview
            ? "Loading…"
            : playable
              ? undefined
              : "Preview unavailable · download to listen"
        }
      />
    );
  }
  return (
    <>
      {searchBar}
      {header}
      <div ref={transcriptRoot}>{body}</div>
    </>
  );
}
