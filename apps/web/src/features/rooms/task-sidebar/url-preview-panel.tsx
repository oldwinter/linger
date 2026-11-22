import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  RotateClockwiseIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState } from "react";

import { isDesktopShell } from "@/app/desktop-shell";
import { Icon } from "@/components/ui/icon";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { shouldOpenUrlExternally } from "../url-preview-policy";
import { urlPreviewMessages as m } from "./url-preview.messages";

const previewSandbox = "allow-forms allow-scripts";

// The desktop app keeps the framing rules of a frame named with this prefix
// and reports a refusal through `window.lingerDesktop.preview`. It must match
// the desktop's PREVIEW_FRAME_PREFIX.
const PREVIEW_FRAME_PREFIX = "linger-url-preview:";

interface DesktopPreview {
  onFrameRefused(
    callback: (frameName: string, url: string) => void,
  ): () => void;
}

function desktopPreview() {
  return (window as { lingerDesktop?: { preview?: DesktopPreview } })
    .lingerDesktop?.preview;
}

interface RefusedFrame {
  frameKey: string;
  url: string;
}

// The development server proxies previews, so its frames share the app's
// origin and get no storage. The desktop app frames sites directly, even when
// it runs a development server on this computer.
function previewProxied() {
  return import.meta.env.DEV && !isDesktopShell();
}

function previewFrameSrc(url: string) {
  if (!previewProxied()) return url;
  return `/__panel_url_preview?url=${encodeURIComponent(url)}`;
}

function safePreviewUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return normalizePreviewUrl(value);
  } catch {
    return undefined;
  }
}

function normalizePreviewUrl(value: string) {
  const input = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input)
    ? input
    : `https://${input}`;
  const url = new URL(candidate);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Not an HTTP(S) URL without credentials.");
  }
  return url.href;
}

export function UrlPreviewPanel({
  hidden = false,
  url,
}: {
  hidden?: boolean;
  url?: string;
}) {
  return (
    <UrlPreviewSession
      hidden={hidden}
      key={safePreviewUrl(url) ?? "home"}
      url={url}
    />
  );
}

function UrlPreviewSession({
  hidden = false,
  url,
}: {
  hidden?: boolean;
  url?: string;
}) {
  const t = useT();
  const initialUrl = safePreviewUrl(url);
  const [history, setHistory] = useState<string[]>(
    initialUrl ? [initialUrl] : [],
  );
  const [index, setIndex] = useState(initialUrl ? 0 : -1);
  const [address, setAddress] = useState(initialUrl ?? "");
  const [invalidAddress, setInvalidAddress] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameName = PREVIEW_FRAME_PREFIX + useId();
  const [refusedFrame, setRefusedFrame] = useState<RefusedFrame | null>(null);
  const currentUrl = history[index];
  const frameKey = `${currentUrl}:${reloadKey}`;
  const refused = refusedFrame?.frameKey === frameKey ? refusedFrame : null;
  const externalOnly = currentUrl
    ? shouldOpenUrlExternally(new URL(currentUrl))
    : false;

  useEffect(
    () =>
      desktopPreview()?.onFrameRefused((name, url) => {
        if (name === frameName) setRefusedFrame({ frameKey, url });
      }),
    [frameKey, frameName],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "linger-preview-navigate" || !data.url) return;
      navigate(data.url, false);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  function navigate(value: string, fromUser = true) {
    try {
      const url = normalizePreviewUrl(value);
      if (fromUser && shouldOpenUrlExternally(new URL(url))) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      const next = [...history.slice(0, index + 1), url];
      setHistory(next);
      setIndex(next.length - 1);
      setAddress(url);
      setInvalidAddress(false);
    } catch {
      setInvalidAddress(true);
    }
  }

  function move(nextIndex: number) {
    const url = history[nextIndex];
    if (!url) return;
    setIndex(nextIndex);
    setAddress(url);
    setInvalidAddress(false);
  }

  return (
    <section
      className={hidden ? "hidden" : "flex h-full min-h-0 flex-col bg-card"}
      hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-border bg-card px-2">
        <button
          aria-label={t(commonMessages.back)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          disabled={index <= 0}
          onClick={() => move(index - 1)}
          type="button"
        >
          <Icon icon={ArrowLeft01Icon} size={16} />
        </button>
        <button
          aria-label={t(m.forward)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          disabled={index < 0 || index >= history.length - 1}
          onClick={() => move(index + 1)}
          type="button"
        >
          <Icon icon={ArrowRight01Icon} size={16} />
        </button>
        <button
          aria-label={t(m.reload)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          disabled={!currentUrl || externalOnly}
          onClick={() => setReloadKey((value) => value + 1)}
          type="button"
        >
          <Icon icon={RotateClockwiseIcon} size={14} />
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(address);
          }}
        >
          <label className="sr-only" htmlFor="panel-url-address">
            {t(m.urlAddress)}
          </label>
          <div>
            <input
              aria-invalid={invalidAddress}
              className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-center text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/50 focus:border-input focus:bg-card focus:text-foreground"
              id="panel-url-address"
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t(m.enterUrl)}
              spellCheck={false}
              value={address}
            />
          </div>
        </form>
        {currentUrl ? (
          <a
            aria-label={t(m.openInNewTab)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            href={currentUrl}
            rel="noopener noreferrer"
            target="_blank"
            title={t(m.openInNewTab)}
          >
            <Icon icon={ArrowUpRight01Icon} size={16} />
          </a>
        ) : null}
      </div>
      {invalidAddress ? (
        <p
          className="border-b border-(--app-status-danger-border) bg-(--app-status-danger-surface) px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {t(m.invalidUrl)}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 bg-card">
        {!currentUrl ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t(m.enterUrlToPreview)}
          </p>
        ) : externalOnly ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t(m.openInBrowserTab)}
          </p>
        ) : refused ? (
          <div className="flex flex-col items-start gap-2 p-4 text-sm">
            <p className="font-medium text-foreground">
              {t(m.openSiteInNewTab)}
            </p>
            <p className="text-muted-foreground">
              {t(m.siteRefusesFrame, { host: new URL(refused.url).host })}
            </p>
            <a
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              href={refused.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t(m.openInNewTab)}
              <Icon icon={ArrowUpRight01Icon} size={14} />
            </a>
          </div>
        ) : (
          <iframe
            className="h-full w-full border-0 bg-white"
            key={frameKey}
            name={frameName}
            ref={frameRef}
            sandbox={
              previewProxied()
                ? previewSandbox
                : `${previewSandbox} allow-same-origin`
            }
            src={previewFrameSrc(currentUrl)}
            title={t(m.previewTitle, { url: currentUrl })}
          />
        )}
      </div>
    </section>
  );
}
