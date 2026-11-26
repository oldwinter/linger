import {
  Attachment01Icon,
  ClipboardCopyIcon,
  EyeIcon,
  FlashIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { fileToBase64, type HerdrCoreClient } from "./api";
import { herdrCoreMessages as m } from "./herdr-core.messages";
import type {
  HerdrCoreAttachClientMessage,
  HerdrCoreAttachServerMessage,
} from "./types";

interface XtermLike {
  cols: number;
  rows: number;
  open(container: HTMLElement): void;
  write(data: Uint8Array | string): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  loadAddon(addon: unknown): void;
  onData(listener: (data: string) => void): { dispose(): void };
  dispose(): void;
}

interface FitAddonLike {
  fit(): void;
}

export interface LazyXtermViewProps {
  readonly client: HerdrCoreClient;
  readonly address: string;
  readonly initialCols?: number;
  readonly initialRows?: number;
  readonly history?: number;
  readonly onStatusMessage?: (message: HerdrCoreAttachServerMessage) => void;
}

type ConnectionPhase =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

interface LandedFileNotice {
  readonly path: string;
  readonly name: string;
}

const MAX_RECONNECT_ATTEMPTS = 5;

function readTerminalThemeFromTokens(): Record<string, string> {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return {};
  }
  const styles = getComputedStyle(document.documentElement);
  const bg = styles.getPropertyValue("--app-surface").trim();
  const fg = styles.getPropertyValue("--app-ink").trim();
  const selection = styles.getPropertyValue("--app-selected").trim();
  const theme: Record<string, string> = {};
  if (bg) theme.background = bg;
  if (fg) {
    theme.foreground = fg;
    theme.cursor = fg;
  }
  if (selection) theme.selectionBackground = selection;
  return theme;
}

export function LazyXtermView({
  client,
  address,
  initialCols = 100,
  initialRows = 30,
  history = 200,
  onStatusMessage,
}: LazyXtermViewProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<XtermLike | null>(null);
  const fitRef = useRef<FitAddonLike | null>(null);
  const observeRef = useRef(true);
  const onStatusRef = useRef(onStatusMessage);
  onStatusRef.current = onStatusMessage;

  const [observe, setObserve] = useState(true);
  const [phase, setPhase] = useState<ConnectionPhase>("connecting");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [landedFile, setLandedFile] = useState<LandedFileNotice | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [reconnectToken, setReconnectToken] = useState(0);

  const sendControl = useCallback((message: HerdrCoreAttachClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }, []);

  const toggleMode = useCallback(() => {
    const nextObserve = !observeRef.current;
    observeRef.current = nextObserve;
    setObserve(nextObserve);
    setErrorText(null);
    const term = termRef.current;
    sendControl({
      type: "mode",
      observe: nextObserve,
      ...(term ? { cols: term.cols, rows: term.rows } : {}),
    });
    if (!nextObserve) {
      term?.focus();
    }
  }, [sendControl]);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setErrorText(null);
      try {
        const dataBase64 = await fileToBase64(file);
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "put",
              name: file.name,
              data_base64: dataBase64,
            } satisfies HerdrCoreAttachClientMessage),
          );
          return;
        }
        const res = await client.putFile({
          address,
          name: file.name,
          data_base64: dataBase64,
        });
        setLandedFile({ path: res.path, name: file.name });
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : String(error));
      } finally {
        setUploading(false);
      }
    },
    [address, client],
  );

  const pasteLandedPath = useCallback(() => {
    if (!landedFile) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && !observeRef.current) {
      ws.send(new TextEncoder().encode(landedFile.path));
      termRef.current?.focus();
      return;
    }
    void client
      .sendPrompt({ address, text: landedFile.path })
      .catch((error: unknown) => {
        setErrorText(error instanceof Error ? error.message : String(error));
      });
  }, [address, client, landedFile]);

  const copyLandedPath = useCallback(() => {
    if (!landedFile) return;
    void navigator.clipboard?.writeText(landedFile.path).then(() => {
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1_500);
    });
  }, [landedFile]);

  // Effect depends ONLY on resource identity (client, address, history, reconnectToken).
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let resizeTimer: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let attempt = 0;
    let term: XtermLike | null = null;
    let fitAddon: FitAddonLike | null = null;
    let onDataSub: { dispose(): void } | null = null;

    observeRef.current = true;
    setObserve(true);
    setPhase("connecting");
    setErrorText(null);

    const openSocket = (resumed: boolean) => {
      if (disposed) return;
      const cols = term?.cols ?? initialCols;
      const rows = term?.rows ?? initialRows;
      const url = client.buildAttachWsUrl({
        address,
        cols,
        rows,
        observe: observeRef.current,
        history,
        resumed,
      });

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (disposed || wsRef.current !== ws) return;
        attempt = 0;
        setPhase("connected");
        setErrorText(null);
      });

      ws.addEventListener("message", (event) => {
        if (disposed || wsRef.current !== ws) return;
        if (
          event.data instanceof ArrayBuffer ||
          Object.prototype.toString.call(event.data) === "[object ArrayBuffer]"
        ) {
          term?.write(new Uint8Array(event.data as ArrayBuffer));
          return;
        }
        if (ArrayBuffer.isView(event.data)) {
          term?.write(
            new Uint8Array(
              event.data.buffer,
              event.data.byteOffset,
              event.data.byteLength,
            ),
          );
          return;
        }
        if (typeof Blob !== "undefined" && event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buf) => {
            if (!disposed) term?.write(new Uint8Array(buf));
          });
          return;
        }
        if (typeof event.data !== "string") return;
        let parsed: HerdrCoreAttachServerMessage;
        try {
          parsed = JSON.parse(event.data) as HerdrCoreAttachServerMessage;
        } catch {
          return;
        }
        onStatusRef.current?.(parsed);
        if (parsed.type === "attached") {
          setPhase("connected");
          if (typeof parsed.observe === "boolean") {
            observeRef.current = parsed.observe;
            setObserve(parsed.observe);
          }
          if (
            typeof parsed.cols === "number" &&
            typeof parsed.rows === "number" &&
            parsed.observe !== false
          ) {
            term?.resize(parsed.cols, parsed.rows);
          }
        } else if (parsed.type === "resize") {
          term?.resize(parsed.cols, parsed.rows);
        } else if (parsed.type === "put_result") {
          setUploading(false);
          setLandedFile({
            path: parsed.path,
            name: parsed.name ?? parsed.path,
          });
        } else if (parsed.type === "error") {
          setUploading(false);
          setErrorText(parsed.message);
        } else if (parsed.type === "closed") {
          setPhase("closed");
        }
      });

      ws.addEventListener("close", () => {
        if (disposed || wsRef.current !== ws) return;
        wsRef.current = null;
        if (attempt < MAX_RECONNECT_ATTEMPTS) {
          attempt += 1;
          setPhase("reconnecting");
          const delay = Math.min(10_000, 1_000 * 2 ** (attempt - 1));
          reconnectTimer = window.setTimeout(() => {
            openSocket(true);
          }, delay);
        } else {
          setPhase("closed");
        }
      });

      ws.addEventListener("error", () => {
        if (disposed || wsRef.current !== ws) return;
        setPhase("error");
      });
    };

    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }, { WebLinksAddon }] =
          await Promise.all([
            import("@xterm/xterm"),
            import("@xterm/addon-fit"),
            import("@xterm/addon-web-links"),
            import("@xterm/xterm/css/xterm.css"),
          ]);
        if (disposed) return;

        const instance = new Terminal({
          cols: initialCols,
          rows: initialRows,
          convertEol: false,
          cursorBlink: true,
          fontSize: 12,
          fontFamily:
            "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          theme: readTerminalThemeFromTokens(),
        }) as unknown as XtermLike;

        const fit = new FitAddon() as unknown as FitAddonLike;
        instance.loadAddon(fit);
        instance.loadAddon(new WebLinksAddon());

        if (hostRef.current) {
          instance.open(hostRef.current);
          try {
            fit.fit();
          } catch {
            // Container may not have layout metrics yet (e.g. hidden or jsdom).
          }
        }

        term = instance;
        fitAddon = fit;
        termRef.current = instance;
        fitRef.current = fit;

        onDataSub = instance.onData((data) => {
          if (observeRef.current) return;
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(new TextEncoder().encode(data));
        });

        if (hostRef.current && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            if (disposed || !fitAddon || !term) return;
            if (resizeTimer !== null) window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
              if (disposed || !fitAddon || !term) return;
              try {
                fitAddon.fit();
              } catch {
                return;
              }
              if (!observeRef.current) {
                const ws = wsRef.current;
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: "resize",
                      cols: term.cols,
                      rows: term.rows,
                    } satisfies HerdrCoreAttachClientMessage),
                  );
                }
              }
            }, 80);
          });
          resizeObserver.observe(hostRef.current);
        }

        openSocket(false);
      } catch (error) {
        if (!disposed) {
          setPhase("error");
          setErrorText(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      onDataSub?.dispose();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState <= WebSocket.OPEN) {
        ws.close();
      }
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [address, client, history, initialCols, initialRows, reconnectToken]);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = event.clipboardData.files?.[0];
    if (file) {
      event.preventDefault();
      void uploadFile(file);
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="herdr-xterm-view"
      onDragLeave={() => setDragActive(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              observe
                ? "border-[var(--app-status-neutral-border)] bg-[var(--app-status-neutral-surface)] text-[var(--app-status-neutral-text)]"
                : "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] text-[var(--app-status-warning-text)]",
            )}
            data-testid="herdr-pty-mode-badge"
          >
            <Icon icon={observe ? EyeIcon : FlashIcon} size={12} />
            <span>
              {observe ? t(m.observeModeBadge) : t(m.interactiveModeBadge)}
            </span>
          </span>
          {phase === "connecting" ? (
            <span className="text-xs text-muted-foreground">
              {t(m.connectingPty)}
            </span>
          ) : phase === "reconnecting" ? (
            <span className="text-xs text-[var(--app-status-warning-text)]">
              {t(m.reconnectingPty)}
            </span>
          ) : phase === "closed" ? (
            <span className="text-xs text-muted-foreground">
              {t(m.ptyClosed)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            aria-label={t(m.uploadFileAction)}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <Button
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
            size="compact"
            tone="secondary"
          >
            <Icon icon={Attachment01Icon} size={14} />
            <span>
              {uploading ? t(m.uploadingFile) : t(m.uploadFileAction)}
            </span>
          </Button>
          {phase === "closed" || phase === "error" ? (
            <Button
              onClick={() => setReconnectToken((v) => v + 1)}
              size="compact"
              tone="secondary"
            >
              <Icon icon={RefreshIcon} size={14} />
              <span>{t(m.reconnectPty)}</span>
            </Button>
          ) : null}
          <Button
            data-testid="herdr-take-over-toggle"
            data-voice-risk="confirm"
            onClick={toggleMode}
            size="compact"
            tone={observe ? "primary" : "secondary"}
          >
            <Icon icon={observe ? FlashIcon : EyeIcon} size={14} />
            <span>
              {observe ? t(m.takeOverAction) : t(m.returnObserveAction)}
            </span>
          </Button>
        </div>
      </div>

      {observe ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          {t(m.observeHint)}
        </p>
      ) : null}

      {errorText ? (
        <p
          className="rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-2.5 py-1.5 text-xs text-[var(--app-status-danger-text)]"
          role="alert"
        >
          {errorText}
        </p>
      ) : null}

      {landedFile ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-status-success-border)] bg-[var(--app-status-success-surface)] px-2.5 py-1.5 text-xs text-[var(--app-status-success-text)]"
          data-testid="herdr-landed-file"
          role="status"
        >
          <span className="min-w-0 flex-1 truncate font-mono">
            {t(m.fileLanded, { path: landedFile.path })}
          </span>
          <div className="flex items-center gap-1">
            <Button onClick={copyLandedPath} size="compact" tone="secondary">
              <Icon icon={ClipboardCopyIcon} size={12} />
              <span>{copiedPath ? t(m.copied) : t(m.copyPath)}</span>
            </Button>
            <Button
              data-voice-risk="confirm"
              onClick={pasteLandedPath}
              size="compact"
              tone="primary"
            >
              {t(m.pastePath)}
            </Button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "relative min-h-[240px] flex-1 overflow-hidden rounded-lg border bg-card p-1.5",
          dragActive ? "border-foreground ring-2 ring-ring" : "border-border",
        )}
      >
        <div className="h-full w-full" ref={hostRef} />
        {dragActive ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-card/90 text-xs font-medium text-foreground">
            {t(m.dropFileHint)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default LazyXtermView;
