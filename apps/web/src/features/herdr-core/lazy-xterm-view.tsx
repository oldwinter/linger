import {
  Attachment01Icon,
  Cancel01Icon,
  ClipboardCopyIcon,
  EyeIcon,
  FlashIcon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
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
import { resolveXtermTheme, XTERM_FONT_FAMILY } from "./xterm-theme";

interface XtermLike {
  cols: number;
  rows: number;
  options?: { theme?: unknown };
  textarea?: HTMLTextAreaElement;
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
  const dragDepthRef = useRef(0);
  const initialSizeRef = useRef({ cols: initialCols, rows: initialRows });
  const onStatusRef = useRef(onStatusMessage);

  useEffect(() => {
    onStatusRef.current = onStatusMessage;
  }, [onStatusMessage]);

  useEffect(() => {
    initialSizeRef.current = { cols: initialCols, rows: initialRows };
  }, [initialCols, initialRows]);

  const [observe, setObserve] = useState(true);
  const [phase, setPhase] = useState<ConnectionPhase>("connecting");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [landedFile, setLandedFile] = useState<LandedFileNotice | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [reconnectToken, setReconnectToken] = useState(0);
  const [observeNudge, setObserveNudge] = useState(false);

  const sendControl = useCallback((message: HerdrCoreAttachClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }, []);

  const toggleMode = useCallback(() => {
    const nextObserve = !observeRef.current;
    observeRef.current = nextObserve;
    setObserve(nextObserve);
    setObserveNudge(false);
    setErrorText(null);
    const fit = fitRef.current;
    const term = termRef.current;
    if (!nextObserve && fit) {
      try {
        fit.fit();
      } catch {
        // Ignore fit metrics errors when container has not painted yet.
      }
    }
    sendControl({
      type: "mode",
      observe: nextObserve,
      ...(term ? { cols: term.cols, rows: term.rows } : {}),
    });
    if (!nextObserve) {
      sendControl({ type: "focus", focused: true });
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
        // WS `put` frames are interactive-only on the relay; use REST in
        // observe mode or when the socket is disconnected so uploads always work.
        if (ws && ws.readyState === WebSocket.OPEN && !observeRef.current) {
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
        setUploading(false);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : String(error));
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
  // Terminal dimension updates from polling never recreate the WS or xterm canvas.
  useEffect(
    () =>
      startXtermAttachSession({
        address,
        client,
        history,
        initialSizeRef,
        hostRef,
        wsRef,
        termRef,
        fitRef,
        observeRef,
        onStatusRef,
        setObserve,
        setPhase,
        setErrorText,
        setUploading,
        setLandedFile,
        setObserveNudge,
      }),
    [address, client, history, reconnectToken],
  );

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
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

  const phasePresentation = (() => {
    switch (phase) {
      case "connected":
        return {
          label: t(m.ptyConnected),
          dotClass: "bg-[var(--app-status-success-text)]",
          textClass: "text-[var(--app-status-success-text)]",
        };
      case "connecting":
        return {
          label: t(m.connectingPty),
          dotClass: "bg-muted-foreground animate-pulse",
          textClass: "text-muted-foreground",
        };
      case "reconnecting":
        return {
          label: t(m.reconnectingPty),
          dotClass: "bg-[var(--app-status-warning-text)] animate-pulse",
          textClass: "text-[var(--app-status-warning-text)]",
        };
      case "error":
        return {
          label: t(m.ptyErrorStatus),
          dotClass: "bg-[var(--app-status-danger-text)]",
          textClass: "text-[var(--app-status-danger-text)]",
        };
      case "closed":
        return {
          label: t(m.ptyClosed),
          dotClass: "bg-muted-foreground",
          textClass: "text-muted-foreground",
        };
    }
  })();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="herdr-xterm-view"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {/* Top control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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

          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-medium",
              phasePresentation.textClass,
            )}
            data-pty-phase={phase}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                phasePresentation.dotClass,
              )}
            />
            <span>{phasePresentation.label}</span>
          </span>
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
            <Icon icon={Attachment01Icon} size={13} />
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
              <Icon icon={RefreshIcon} size={13} />
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
            <Icon icon={observe ? FlashIcon : EyeIcon} size={13} />
            <span>
              {observe ? t(m.takeOverAction) : t(m.returnObserveAction)}
            </span>
          </Button>
        </div>
      </div>

      {/* Clear Observe Spectator Banner */}
      {observe ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors",
            observeNudge
              ? "border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] text-[var(--app-status-warning-text)]"
              : "border-border/80 bg-muted/35 text-muted-foreground",
          )}
          data-testid="herdr-observe-banner"
        >
          <span>{t(m.observeHint)}</span>
        </div>
      ) : null}

      {errorText ? (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-2.5 py-1.5 text-xs text-[var(--app-status-danger-text)]"
          role="alert"
        >
          <span className="min-w-0 break-words">{errorText}</span>
          <button
            aria-label={t(m.dismissNotice)}
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            data-voice-close
            onClick={() => setErrorText(null)}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        </div>
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
              <Icon
                icon={copiedPath ? Tick02Icon : ClipboardCopyIcon}
                size={12}
              />
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
            <button
              aria-label={t(m.dismissNotice)}
              className="rounded p-1 opacity-70 hover:opacity-100"
              data-voice-close
              onClick={() => setLandedFile(null)}
              type="button"
            >
              <Icon icon={Cancel01Icon} size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {/* xterm.js canvas host */}
      <div
        className={cn(
          "relative min-h-[240px] flex-1 overflow-hidden rounded-lg border bg-card p-2",
          dragActive
            ? "border-foreground ring-2 ring-ring"
            : observe
              ? "border-border"
              : "border-[var(--app-status-warning-border)]",
        )}
      >
        <div className="h-full w-full overflow-hidden" ref={hostRef} />
        {dragActive ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-card/90 text-center">
            <span className="text-xs font-semibold text-foreground">
              {t(m.dropFileTitle)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t(m.dropFileHint)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface StartXtermAttachSessionOptions {
  readonly address: string;
  readonly client: HerdrCoreClient;
  readonly history: number;
  readonly initialSizeRef: RefObject<{
    readonly cols: number;
    readonly rows: number;
  }>;
  readonly hostRef: RefObject<HTMLDivElement | null>;
  readonly wsRef: RefObject<WebSocket | null>;
  readonly termRef: RefObject<XtermLike | null>;
  readonly fitRef: RefObject<FitAddonLike | null>;
  readonly observeRef: RefObject<boolean>;
  readonly onStatusRef: RefObject<
    ((message: HerdrCoreAttachServerMessage) => void) | undefined
  >;
  readonly setObserve: (value: boolean) => void;
  readonly setPhase: (phase: ConnectionPhase) => void;
  readonly setErrorText: (value: string | null) => void;
  readonly setUploading: (value: boolean) => void;
  readonly setLandedFile: (value: LandedFileNotice | null) => void;
  readonly setObserveNudge: (value: boolean) => void;
}

function startXtermAttachSession(
  options: StartXtermAttachSessionOptions,
): () => void {
  const {
    address,
    client,
    history,
    initialSizeRef,
    hostRef,
    wsRef,
    termRef,
    fitRef,
    observeRef,
    onStatusRef,
    setObserve,
    setPhase,
    setErrorText,
    setUploading,
    setLandedFile,
    setObserveNudge,
  } = options;

  let disposed = false;
  let reconnectTimer: number | null = null;
  let resizeTimer: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let mediaQuery: MediaQueryList | null = null;
  let mediaListener: (() => void) | null = null;
  let focusHandler: (() => void) | null = null;
  let blurHandler: (() => void) | null = null;
  let hostClickHandler: (() => void) | null = null;
  const hostEl = hostRef.current;
  let attempt = 0;
  let term: XtermLike | null = null;
  let fitAddon: FitAddonLike | null = null;
  let onDataSub: { dispose(): void } | null = null;
  let lastSentCols = 0;
  let lastSentRows = 0;

  observeRef.current = true;
  setObserve(true);
  setPhase("connecting");
  setErrorText(null);

  const openSocket = (resumed: boolean) => {
    if (disposed) return;
    const cols = term?.cols ?? initialSizeRef.current.cols;
    const rows = term?.rows ?? initialSizeRef.current.rows;
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
        if (parsed.ok === false || !parsed.path) {
          setErrorText(parsed.error ?? "File upload failed.");
        } else {
          setLandedFile({
            path: parsed.path,
            name: parsed.name ?? parsed.path,
          });
        }
      } else if (parsed.type === "error") {
        setUploading(false);
        setErrorText(parsed.message);
      } else if (parsed.type === "closed") {
        setUploading(false);
        setPhase("closed");
      }
    });

    ws.addEventListener("close", () => {
      if (disposed || wsRef.current !== ws) return;
      wsRef.current = null;
      setUploading(false);
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
      setUploading(false);
      setPhase("error");
    });
  };

  void (async () => {
    try {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all(
        [
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-web-links"),
          import("@xterm/xterm/css/xterm.css"),
        ],
      );
      if (disposed) return;

      const { cols: initCols, rows: initRows } = initialSizeRef.current;
      const instance = new Terminal({
        cols: initCols,
        rows: initRows,
        convertEol: false,
        cursorBlink: true,
        fontSize: 12,
        lineHeight: 1.3,
        fontFamily: XTERM_FONT_FAMILY,
        scrollback: 5_000,
        theme: resolveXtermTheme(),
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
      lastSentCols = instance.cols;
      lastSentRows = instance.rows;

      // Sync xterm.js colors live when Town Light <-> Town Dark changes.
      const applyTheme = () => {
        if (disposed || !term?.options) return;
        term.options.theme = resolveXtermTheme();
      };
      if (
        typeof MutationObserver !== "undefined" &&
        typeof document !== "undefined"
      ) {
        themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
      }
      if (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function"
      ) {
        mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaListener = applyTheme;
        mediaQuery.addEventListener?.("change", mediaListener);
      }

      // Forward focus transitions while in interactive mode.
      if (instance.textarea) {
        focusHandler = () => {
          if (observeRef.current) return;
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "focus",
                focused: true,
              } satisfies HerdrCoreAttachClientMessage),
            );
          }
        };
        blurHandler = () => {
          if (observeRef.current) return;
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "focus",
                focused: false,
              } satisfies HerdrCoreAttachClientMessage),
            );
          }
        };
        instance.textarea.addEventListener("focus", focusHandler);
        instance.textarea.addEventListener("blur", blurHandler);
      }

      if (hostEl) {
        hostClickHandler = () => {
          if (observeRef.current) {
            setObserveNudge(true);
          } else {
            termRef.current?.focus();
          }
        };
        hostEl.addEventListener("click", hostClickHandler);
      }

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
            const prevCols = term.cols;
            const prevRows = term.rows;
            try {
              fitAddon.fit();
            } catch {
              return;
            }
            if (
              !observeRef.current &&
              (term.cols !== lastSentCols ||
                term.rows !== lastSentRows ||
                term.cols !== prevCols ||
                term.rows !== prevRows)
            ) {
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                lastSentCols = term.cols;
                lastSentRows = term.rows;
                ws.send(
                  JSON.stringify({
                    type: "resize",
                    cols: term.cols,
                    rows: term.rows,
                  } satisfies HerdrCoreAttachClientMessage),
                );
              }
            }
          }, 100);
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
    themeObserver?.disconnect();
    if (mediaQuery && mediaListener) {
      mediaQuery.removeEventListener?.("change", mediaListener);
    }
    if (hostEl && hostClickHandler) {
      hostEl.removeEventListener("click", hostClickHandler);
    }
    if (term?.textarea) {
      if (focusHandler)
        term.textarea.removeEventListener("focus", focusHandler);
      if (blurHandler) term.textarea.removeEventListener("blur", blurHandler);
    }
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
}

export default LazyXtermView;
