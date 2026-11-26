import { useQuery } from "@tanstack/react-query";
import {
  Attachment01Icon,
  ClipboardCopyIcon,
  Delete02Icon,
  RefreshIcon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { fileToBase64, type HerdrCoreClient } from "./api";
import { herdrCoreMessages as m } from "./herdr-core.messages";
import type { HerdrCoreTerminal } from "./types";

const QUICK_KEYS = [
  { label: "Enter", keys: ["enter"] },
  { label: "Esc", keys: ["esc"] },
  { label: "Ctrl+C", keys: ["ctrl+c"] },
  { label: "↑", keys: ["up"] },
  { label: "↓", keys: ["down"] },
  { label: "y", keys: ["y", "enter"] },
  { label: "n", keys: ["n", "enter"] },
] as const;

interface TerminalLightViewProps {
  readonly client: HerdrCoreClient;
  readonly terminal: HerdrCoreTerminal;
  readonly onRefreshList: () => void;
}

export function TerminalLightView({
  client,
  terminal,
  onRefreshList,
}: TerminalLightViewProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState(120);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [forceSend, setForceSend] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [landedPath, setLandedPath] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);

  const isLive = terminal.state === "live";
  const isBlocked = isLive && terminal.status?.status === "blocked";

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

  async function runAction(label: string, fn: () => Promise<void>) {
    setBusyAction(label);
    setActionError(null);
    try {
      await fn();
      await readQuery.refetch();
      onRefreshList();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !isLive) return;
    void runAction("send", async () => {
      await client.sendPrompt({
        address: terminal.address,
        text,
        ...(isBlocked && forceSend ? { force: true } : {}),
      });
      setPrompt("");
    });
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

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="herdr-light-view"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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

          <Button
            onClick={() => setAutoRefresh((v) => !v)}
            size="compact"
            tone={autoRefresh ? "subtle" : "ghost"}
          >
            {autoRefresh ? t(m.autoRefreshOn) : t(m.autoRefreshOff)}
          </Button>

          <Button
            loading={readQuery.isFetching}
            onClick={() => void readQuery.refetch()}
            size="compact"
            tone="secondary"
          >
            <Icon icon={RefreshIcon} size={14} />
            <span>{t(m.refresh)}</span>
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
                loading={busyAction === "put"}
                onClick={() => fileInputRef.current?.click()}
                size="compact"
                tone="secondary"
              >
                <Icon icon={Attachment01Icon} size={14} />
                <span>{t(m.uploadFileAction)}</span>
              </Button>
              <Button
                data-voice-risk="confirm"
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
                <Icon icon={StopIcon} size={14} />
                <span>{t(m.interruptAction)}</span>
              </Button>
              <Button
                data-voice-risk="never"
                loading={busyAction === "kill"}
                onClick={() =>
                  void runAction("kill", async () => {
                    await client.killTerminal(terminal.address);
                  })
                }
                size="compact"
                tone="danger"
              >
                <Icon icon={Delete02Icon} size={14} />
                <span>{t(m.killAction)}</span>
              </Button>
            </>
          ) : (
            <Button
              data-voice-risk="never"
              loading={busyAction === "remove"}
              onClick={() =>
                void runAction("remove", async () => {
                  await client.removeTerminal(terminal.address);
                })
              }
              size="compact"
              tone="danger"
            >
              <Icon icon={Delete02Icon} size={14} />
              <span>{t(m.removeAction)}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Incomplete screen notice */}
      {readQuery.data && !readQuery.data.complete && readQuery.data.why ? (
        <p className="rounded-lg bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
          {t(m.transcriptIncomplete, { why: readQuery.data.why })}
        </p>
      ) : null}

      {/* Transcript */}
      <div
        aria-label={t(m.transcriptTitle)}
        className="workspace-scrollbar min-h-[180px] flex-1 overflow-auto rounded-lg border border-border bg-muted/35 p-3 font-mono text-xs leading-relaxed text-foreground"
        data-testid="herdr-transcript"
      >
        <pre className="m-0 whitespace-pre-wrap break-words">
          {readQuery.data?.text?.trim()
            ? readQuery.data.text
            : t(m.transcriptEmpty)}
        </pre>
      </div>

      {actionError ? (
        <p
          className="rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-2.5 py-1.5 text-xs text-[var(--app-status-danger-text)]"
          role="alert"
        >
          {actionError}
        </p>
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
              <Icon icon={ClipboardCopyIcon} size={12} />
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

      {/* Quick approval key bar + prompt sender */}
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
                onClick={() =>
                  void runAction(`key:${item.label}`, async () => {
                    await client.sendKeys({
                      address: terminal.address,
                      keys: [...item.keys],
                    });
                  })
                }
                size="compact"
                tone="secondary"
              >
                <span className="font-mono">{item.label}</span>
              </Button>
            ))}
          </div>

          <form className="flex flex-col gap-1.5" onSubmit={handleSend}>
            <div className="flex items-center gap-1.5">
              <input
                aria-label={t(m.promptPlaceholder, {
                  target: terminal.name ?? terminal.address,
                })}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={busyAction !== null}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t(m.promptPlaceholder, {
                  target: terminal.name ?? terminal.address,
                })}
                type="text"
                value={prompt}
              />
              <Button
                data-voice-risk="never"
                disabled={!prompt.trim()}
                loading={busyAction === "send"}
                tone="primary"
                type="submit"
              >
                <Icon icon={SentIcon} size={14} />
                <span>{t(m.sendPrompt)}</span>
              </Button>
            </div>
            {isBlocked ? (
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--app-status-warning-text)]">
                <input
                  checked={forceSend}
                  className="size-3 rounded border-border"
                  onChange={(event) => setForceSend(event.target.checked)}
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
