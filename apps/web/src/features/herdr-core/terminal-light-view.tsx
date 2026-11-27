import { useQuery } from "@tanstack/react-query";
import {
  Alert01Icon,
  ArrowDown01Icon,
  Attachment01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ClipboardCopyIcon,
  Delete02Icon,
  RefreshIcon,
  SentIcon,
  StopIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { fileToBase64, HerdrCoreApiError, type HerdrCoreClient } from "./api";
import { herdrCoreMessages as m } from "./herdr-core.messages";
import { terminalDisplayName, terminalStatusWord } from "./tree";
import type { HerdrCoreTerminal } from "./types";

const QUICK_KEYS = [
  { label: "y", keys: ["y", "enter"] },
  { label: "n", keys: ["n", "enter"] },
  { label: "Enter", keys: ["enter"] },
  { label: "Esc", keys: ["esc"] },
  { label: "↑", keys: ["up"] },
  { label: "↓", keys: ["down"] },
  { label: "Ctrl+C", keys: ["ctrl+c"] },
] as const;

const SCROLL_PIN_THRESHOLD_PX = 28;

interface TerminalLightViewProps {
  readonly client: HerdrCoreClient;
  readonly terminal: HerdrCoreTerminal;
  readonly onRefreshList: () => void;
}

interface ActionFeedback {
  readonly tone: "success" | "warning" | "danger";
  readonly text: string;
}

export function TerminalLightView({
  client,
  terminal,
  onRefreshList,
}: TerminalLightViewProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const hasInitialScrollRef = useRef(false);
  const prevTextRef = useRef<string | undefined>(undefined);
  const feedbackTimerRef = useRef<number | null>(null);

  const [lines, setLines] = useState(120);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [bypassTurnCheck, setBypassTurnCheck] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [landedPath, setLandedPath] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const isLive = terminal.state === "live";
  const isBlocked = isLive && terminalStatusWord(terminal) === "blocked";
  const displayName = terminalDisplayName(terminal);

  const readQuery = useQuery({
    queryKey: [
      "herdr-core",
      "read",
      client.computerId,
      client.transportMode,
      terminal.address,
      lines,
    ],
    queryFn: ({ signal }) =>
      client.readTerminal(terminal.address, lines, signal),
    refetchInterval: autoRefresh && isLive ? 2_500 : false,
    retry: false,
  });

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  // Preserve scroll position during live refresh: auto-follow only when pinned
  // to the bottom, and never pull the user down while reading earlier output.
  const transcriptText = readQuery.data?.text;
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el || transcriptText === undefined) return;
    const textChanged = prevTextRef.current !== transcriptText;
    prevTextRef.current = transcriptText;

    if (!hasInitialScrollRef.current || isPinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      hasInitialScrollRef.current = true;
      setShowJumpToLatest(false);
    } else if (textChanged) {
      setShowJumpToLatest(true);
    }
  }, [transcriptText]);

  function handleTranscriptScroll() {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= SCROLL_PIN_THRESHOLD_PX;
    isPinnedToBottomRef.current = pinned;
    if (pinned) {
      setShowJumpToLatest(false);
    }
  }

  function jumpToLatest() {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isPinnedToBottomRef.current = true;
    setShowJumpToLatest(false);
  }

  function showTransientFeedback(next: ActionFeedback, autoClearMs?: number) {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setFeedback(next);
    if (autoClearMs) {
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback((curr) => (curr === next ? null : curr));
        feedbackTimerRef.current = null;
      }, autoClearMs);
    }
  }

  async function runAction(
    label: string,
    fn: () => Promise<void>,
    options?: { readonly successText?: string },
  ) {
    if (busyAction !== null) return;
    setBusyAction(label);
    setFeedback(null);
    try {
      await fn();
      if (options?.successText) {
        showTransientFeedback(
          { tone: "success", text: options.successText },
          3_000,
        );
      }
      await readQuery.refetch();
      onRefreshList();
    } catch (error) {
      if (
        error instanceof HerdrCoreApiError &&
        (error.kind === "conflict" || error.kind === "blocked")
      ) {
        showTransientFeedback({
          tone: "warning",
          text:
            error.kind === "conflict" ? t(m.staleTurnConflict) : error.message,
        });
      } else {
        showTransientFeedback({
          tone: "danger",
          text: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setBusyAction(null);
    }
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !isLive || busyAction !== null) return;
    void runAction(
      "send",
      async () => {
        if (isBlocked) {
          if (bypassTurnCheck) {
            await client.sendPrompt({
              address: terminal.address,
              text,
              force: true,
            });
          } else {
            await client.sendPrompt({
              address: terminal.address,
              text,
              if: "blocked",
              ...(typeof terminal.turn === "number"
                ? { turn: terminal.turn }
                : {}),
            });
          }
        } else {
          await client.sendPrompt({
            address: terminal.address,
            text,
          });
        }
        setPrompt("");
      },
      { successText: t(m.sentFeedback, { target: displayName }) },
    );
  }

  function handleUpload(file: File) {
    void runAction("put", async () => {
      const dataBase64 = await fileToBase64(file);
      const res = await client.putFile({
        address: terminal.address,
        name: file.name,
        data_base64: dataBase64,
      });
      setLandedPath(res.path);
    });
  }

  function copyLandedPath() {
    if (!landedPath) return;
    void navigator.clipboard?.writeText(landedPath).then(() => {
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1_500);
    });
  }

  const blockedKindLabel = (() => {
    switch (terminal.status?.kind) {
      case "permission":
        return t(m.blockedKindPermission);
      case "question":
        return t(m.blockedKindQuestion);
      case "auth":
        return t(m.blockedKindAuth);
      default:
        return t(m.blockedBannerTitle);
    }
  })();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="herdr-light-view"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label={t(m.transcriptTitle)}
            className="h-7 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => setLines(Number(event.target.value))}
            value={lines}
          >
            {[60, 120, 300].map((count) => (
              <option key={count} value={count}>
                {t(m.linesLabel, { count })}
              </option>
            ))}
          </select>

          <button
            aria-pressed={autoRefresh}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              autoRefresh
                ? "border-[var(--app-status-success-border)] bg-[var(--app-status-success-surface)] text-[var(--app-status-success-text)]"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setAutoRefresh((v) => !v)}
            title={t(m.autoRefreshToggleTitle)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                autoRefresh
                  ? "bg-[var(--app-status-success-text)]"
                  : "bg-muted-foreground/50",
              )}
            />
            <span>
              {autoRefresh ? t(m.autoRefreshOn) : t(m.autoRefreshOff)}
            </span>
          </button>

          <Button
            aria-label={t(m.refresh)}
            loading={readQuery.isFetching}
            onClick={() => void readQuery.refetch()}
            size="compactIcon"
            title={t(m.refresh)}
            tone="secondary"
          >
            <Icon icon={RefreshIcon} size={13} />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {isLive ? (
            <>
              <input
                aria-label={t(m.uploadFileAction)}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleUpload(file);
                  event.target.value = "";
                }}
                ref={fileInputRef}
                type="file"
              />
              <Button
                disabled={busyAction !== null && busyAction !== "put"}
                loading={busyAction === "put"}
                onClick={() => fileInputRef.current?.click()}
                size="compact"
                tone="secondary"
              >
                <Icon icon={Attachment01Icon} size={13} />
                <span>{t(m.uploadFileAction)}</span>
              </Button>
              <Button
                data-voice-risk="confirm"
                disabled={busyAction !== null && busyAction !== "interrupt"}
                loading={busyAction === "interrupt"}
                onClick={() =>
                  void runAction("interrupt", async () => {
                    await client.interruptTerminal({
                      address: terminal.address,
                    });
                  })
                }
                size="compact"
                tone="secondary"
              >
                <Icon icon={StopIcon} size={13} />
                <span>{t(m.interruptAction)}</span>
              </Button>
              {confirmingKill ? (
                <div className="inline-flex items-center gap-1">
                  <Button
                    data-voice-risk="never"
                    loading={busyAction === "kill"}
                    onClick={() =>
                      void runAction("kill", async () => {
                        await client.killTerminal(terminal.address);
                        setConfirmingKill(false);
                      })
                    }
                    size="compact"
                    tone="danger"
                  >
                    <Icon icon={Delete02Icon} size={13} />
                    <span>{t(m.confirmKillAction)}</span>
                  </Button>
                  <Button
                    data-voice-close
                    onClick={() => setConfirmingKill(false)}
                    size="compact"
                    tone="ghost"
                  >
                    {t(m.launchCancel)}
                  </Button>
                </div>
              ) : (
                <Button
                  data-voice-risk="never"
                  disabled={busyAction !== null}
                  onClick={() => setConfirmingKill(true)}
                  size="compact"
                  tone="danger"
                >
                  <Icon icon={Delete02Icon} size={13} />
                  <span>{t(m.killAction)}</span>
                </Button>
              )}
            </>
          ) : (
            <Button
              data-voice-risk="never"
              disabled={busyAction !== null && busyAction !== "remove"}
              loading={busyAction === "remove"}
              onClick={() =>
                void runAction("remove", async () => {
                  await client.removeTerminal(terminal.address);
                })
              }
              size="compact"
              tone="danger"
            >
              <Icon icon={Delete02Icon} size={13} />
              <span>{t(m.removeAction)}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Prominent Blocked Attention Banner */}
      {isBlocked ? (
        <div
          className="flex flex-col gap-1 rounded-lg border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-3 py-2 text-xs"
          data-testid="herdr-blocked-banner"
        >
          <div className="flex items-center gap-1.5 font-semibold text-[var(--app-status-warning-text)]">
            <Icon icon={Alert01Icon} size={13} />
            <span>{blockedKindLabel}</span>
          </div>
          {terminal.status?.msg ? (
            <p className="text-xs leading-snug text-foreground">
              {terminal.status.msg}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Incomplete screen notice */}
      {readQuery.data && !readQuery.data.complete && readQuery.data.why ? (
        <p className="rounded-lg bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
          {t(m.transcriptIncomplete, { why: readQuery.data.why })}
        </p>
      ) : null}

      {/* Transcript container with scroll preservation */}
      <div className="relative flex min-h-[160px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-muted/35">
        {readQuery.isPending ? (
          <div
            aria-busy="true"
            aria-label={t(m.loadingTranscript)}
            className="flex flex-1 flex-col gap-2 p-3"
            role="status"
          >
            <Skeleton className="h-3.5 w-3/4 rounded" />
            <Skeleton className="h-3.5 w-1/2 rounded" />
            <Skeleton className="h-3.5 w-5/6 rounded" />
            <Skeleton className="h-3.5 w-2/3 rounded" />
          </div>
        ) : (
          <div
            aria-label={t(m.transcriptTitle)}
            className="workspace-scrollbar flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground"
            data-testid="herdr-transcript"
            onScroll={handleTranscriptScroll}
            ref={transcriptRef}
          >
            <pre className="m-0 whitespace-pre-wrap break-words">
              {readQuery.data?.text?.trim()
                ? readQuery.data.text
                : t(m.transcriptEmpty)}
            </pre>
          </div>
        )}

        {showJumpToLatest ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <button
              className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={jumpToLatest}
              type="button"
            >
              <Icon icon={ArrowDown01Icon} size={12} />
              <span>{t(m.jumpToLatest)}</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* Action delivery feedback / stale turn conflict / error */}
      {feedback ? (
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
            feedback.tone === "success"
              ? "border-[var(--app-status-success-border)] bg-[var(--app-status-success-surface)] text-[var(--app-status-success-text)]"
              : feedback.tone === "warning"
                ? "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] text-[var(--app-status-warning-text)]"
                : "border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] text-[var(--app-status-danger-text)]",
          )}
          data-testid="herdr-action-feedback"
          role={feedback.tone === "danger" ? "alert" : "status"}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon
              className="shrink-0"
              icon={
                feedback.tone === "success"
                  ? CheckmarkCircle02Icon
                  : Alert01Icon
              }
              size={13}
            />
            <span className="min-w-0 break-words">{feedback.text}</span>
          </span>
          <button
            aria-label={t(m.dismissNotice)}
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            data-voice-close
            onClick={() => setFeedback(null)}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        </div>
      ) : null}

      {landedPath ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-status-success-border)] bg-[var(--app-status-success-surface)] px-2.5 py-1.5 text-xs text-[var(--app-status-success-text)]"
          role="status"
        >
          <span className="min-w-0 flex-1 truncate font-mono">
            {t(m.fileLanded, { path: landedPath })}
          </span>
          <div className="flex items-center gap-1">
            <Button onClick={copyLandedPath} size="compact" tone="secondary">
              <Icon
                icon={copiedPath ? Tick02Icon : ClipboardCopyIcon}
                size={12}
              />
              <span>{copiedPath ? t(m.copied) : t(m.copyPath)}</span>
            </Button>
            <Button
              onClick={() =>
                setPrompt((prev) =>
                  prev ? `${prev} ${landedPath}` : landedPath,
                )
              }
              size="compact"
              tone="primary"
            >
              {t(m.pastePath)}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Quick approval key bar + prompt/reply sender */}
      {isLive ? (
        <div className="flex flex-col gap-2">
          <div
            aria-label={t(m.quickKeysLabel)}
            className="flex flex-wrap items-center gap-1"
            role="group"
          >
            {QUICK_KEYS.map((item) => (
              <Button
                data-voice-risk="confirm"
                disabled={busyAction !== null}
                key={item.label}
                loading={busyAction === `key:${item.label}`}
                onClick={() =>
                  void runAction(
                    `key:${item.label}`,
                    async () => {
                      await client.sendKeys({
                        address: terminal.address,
                        keys: [...item.keys],
                      });
                    },
                    { successText: t(m.sentFeedback, { target: displayName }) },
                  )
                }
                size="compact"
                tone={isBlocked && item.label === "y" ? "primary" : "secondary"}
              >
                <span className="font-mono">{item.label}</span>
              </Button>
            ))}
          </div>

          <form className="flex flex-col gap-1.5" onSubmit={handleSend}>
            <div className="flex items-center gap-1.5">
              <input
                aria-label={
                  isBlocked
                    ? t(m.replyBlockedPlaceholder, { target: displayName })
                    : t(m.promptPlaceholder, { target: displayName })
                }
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={busyAction !== null}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  isBlocked
                    ? t(m.replyBlockedPlaceholder, { target: displayName })
                    : t(m.promptPlaceholder, { target: displayName })
                }
                type="text"
                value={prompt}
              />
              <Button
                data-voice-risk="never"
                disabled={!prompt.trim() || busyAction !== null}
                loading={busyAction === "send"}
                tone="primary"
                type="submit"
              >
                <Icon icon={SentIcon} size={14} />
                <span>{isBlocked ? t(m.sendReply) : t(m.sendPrompt)}</span>
              </Button>
            </div>
            {isBlocked ? (
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  checked={bypassTurnCheck}
                  className="size-3 rounded border-border"
                  onChange={(event) => setBypassTurnCheck(event.target.checked)}
                  type="checkbox"
                />
                <span>{t(m.forceWhenBlocked)}</span>
              </label>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
