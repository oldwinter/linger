import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icon";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";
import type { ArtifactReadingPosition } from "./artifact-preview-cache";
import { filePreviewMessages as m } from "./file-preview.messages";
import { pdfSelectionText } from "./pdf-page-text";
import { repairEscapedNewlinePdf } from "./pdf-preview-bytes";

// The picture is what pdf.js paints. These rules are the part of its text
// layer the selection needs: transparent runs on top of that picture, and a
// tail that covers the page only while a drag is in progress.
const pdfTextLayerStyle = `
.pdf-text-layer {
  --user-unit: 1;
  --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
  --scale-round-x: 1px;
  --scale-round-y: 1px;
  color-scheme: only light;
  position: absolute;
  inset: 0;
  overflow: clip;
  line-height: 1;
  transform-origin: 0 0;
  z-index: 1;
}
.pdf-text-layer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0 0;
  user-select: text;
}
.pdf-text-layer .markedContent { display: contents; }
.pdf-text-layer > :not(.markedContent),
.pdf-text-layer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--total-scale-factor) * var(--min-font-size) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(calc(1 / var(--min-font-size)));
}
.pdf-text-layer ::selection {
  background: rgb(0 0 255 / 0.25);
  color: transparent;
}
.pdf-text-layer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
}
.pdf-text-layer.selecting .endOfContent { top: 0; }
`;

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const maxPdfPages = 500;

export interface PdfPreviewAdapterProps {
  blob: Blob;
  readingPosition?: ArtifactReadingPosition;
  filename: string;
  onError?: (message: string) => void;
}

export function PdfPreviewAdapter({
  blob,
  filename,
  onError,
  readingPosition,
}: PdfPreviewAdapterProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  const sectionRef = useRef<HTMLElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerTask = useRef<TextLayer | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  const [pageNumber, setPageNumber] = useState(
    readingPosition?.pageNumber ?? 1,
  );
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [scale, setScale] = useState(readingPosition?.scale ?? 1);
  const [selectable, setSelectable] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(720);

  useLayoutEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const host = viewportRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextWidth = Math.round(Math.max(280, entry.contentRect.width - 48));
      setAvailableWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(undefined);
    setError(undefined);
    setRendering(true);
    void blob
      .arrayBuffer()
      .then((data) => {
        if (!active) return undefined;
        task = getDocument({
          data: new Uint8Array(repairEscapedNewlinePdf(data)),
          stopAtErrors: true,
          useWorkerFetch: false,
        });
        return task.promise;
      })
      .then((nextDocument) => {
        if (!nextDocument) return;
        if (!active) {
          void task?.destroy();
          return;
        }
        if (nextDocument.numPages > maxPdfPages) {
          void task?.destroy();
          throw new Error(translate(m.pdfTooManyPages, { max: maxPdfPages }));
        }
        setDocument(nextDocument);
        setPageNumber(
          Math.min(
            nextDocument.numPages,
            Math.max(1, readingPosition?.pageNumber ?? 1),
          ),
        );
        setScale(readingPosition?.scale ?? 1);
        setError(undefined);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        const message =
          loadError instanceof Error
            ? translate(m.pdfPreviewFailedDetail, { detail: loadError.message })
            : translate(m.pdfPreviewFailed);
        setError(message);
        onErrorRef.current?.(message);
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [blob, readingPosition]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document) return;
    let active = true;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    setRendering(true);
    setSelectable(false);
    textLayerTask.current?.cancel();
    textLayerTask.current = null;
    textLayerRef.current?.replaceChildren();
    void document
      .getPage(pageNumber)
      .then(async (page) => {
        if (!active) return;
        const natural = page.getViewport({ scale: 1 });
        const fittedScale = Math.min(2.25, availableWidth / natural.width);
        const viewport = page.getViewport({ scale: fittedScale * scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error(translate(m.canvasUnavailable));
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvas,
          canvasContext: context,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
          viewport,
        });
        await renderTask.promise;
        if (!active) return;
        const host = textLayerRef.current;
        if (!host) return;
        // Words are a layer on the picture. A page that has none, or a text
        // pass that fails, still leaves the picture.
        try {
          host.style.setProperty("--scale-factor", String(viewport.scale));
          const content = await page.getTextContent();
          if (!active) return;
          host.replaceChildren();
          const layer = new TextLayer({
            container: host,
            textContentSource: content,
            viewport,
          });
          textLayerTask.current = layer;
          await layer.render();
          if (!active) return;
          const end = window.document.createElement("div");
          end.className = "endOfContent";
          host.append(end);
          setSelectable(
            layer.textContentItemsStr.some((item) => item.trim() !== ""),
          );
        } catch {
          if (active) host.replaceChildren();
        }
      })
      .then(() => {
        if (active) {
          if (readingPosition) {
            if (viewportRef.current) {
              viewportRef.current.scrollTop = readingPosition.scrollTop ?? 0;
              viewportRef.current.scrollLeft = readingPosition.scrollLeft ?? 0;
            }
          }
          setRendering(false);
        }
      })
      .catch((renderError: unknown) => {
        if (
          !active ||
          (renderError instanceof Error &&
            renderError.name === "RenderingCancelledException")
        ) {
          return;
        }
        const message =
          renderError instanceof Error
            ? translate(m.pdfPageFailedDetail, { detail: renderError.message })
            : translate(m.pdfPageFailed);
        setError(message);
        onErrorRef.current?.(message);
      });
    return () => {
      active = false;
      renderTask?.cancel();
      textLayerTask.current?.cancel();
      textLayerTask.current = null;
    };
  }, [availableWidth, document, pageNumber, readingPosition, scale]);

  useEffect(() => {
    const host = textLayerRef.current;
    if (!host) return;
    const startSelecting = (event: MouseEvent) => {
      if (event.button !== 0) return;
      host.classList.add("selecting");
    };
    const endSelecting = () => host.classList.remove("selecting");
    host.addEventListener("mousedown", startSelecting);
    window.addEventListener("mouseup", endSelecting);
    return () => {
      host.removeEventListener("mousedown", startSelecting);
      window.removeEventListener("mouseup", endSelecting);
    };
  }, [error]);

  function copyPageWords(event: ClipboardEvent<HTMLDivElement>) {
    const text = pdfSelectionText(
      event.currentTarget,
      window.document.getSelection(),
    );
    if (!text) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }

  function changePage(next: number) {
    setPageInput(null);
    if (readingPosition) {
      readingPosition.pageNumber = next;
      readingPosition.scrollTop = 0;
      readingPosition.scrollLeft = 0;
    }
    setPageNumber(next);
  }

  function changeScale(next: number) {
    const rounded = Math.round(next * 100) / 100;
    if (readingPosition) readingPosition.scale = rounded;
    setScale(rounded);
  }

  function commitPageInput() {
    if (pageInput === null || !document) {
      setPageInput(null);
      return;
    }
    const parsed = Number.parseInt(pageInput.trim(), 10);
    setPageInput(null);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(document.numPages, Math.max(1, parsed));
    if (clamped !== pageNumber) changePage(clamped);
  }

  const onViewerKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!document) return;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      if (pageNumber <= 1) return;
      event.preventDefault();
      changePage(Math.max(1, pageNumber - 1));
    } else if (event.key === "ArrowRight" || event.key === "PageDown") {
      if (pageNumber >= document.numPages) return;
      event.preventDefault();
      changePage(Math.min(document.numPages, pageNumber + 1));
    }
  });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const listener = (event: KeyboardEvent) => onViewerKeyDown(event);
    section.addEventListener("keydown", listener);
    return () => section.removeEventListener("keydown", listener);
  }, []);

  const displayedPageInput = pageInput ?? String(pageNumber);
  const zoomPercent = Math.round(scale * 100);
  const atDefaultZoom = Math.abs(scale - 1) < 0.001;

  return (
    <section
      aria-label={t(m.pdfPreview, { name: filename })}
      className="flex h-full min-h-[420px] flex-col bg-app-surface-soft"
      ref={sectionRef}
      role="document"
    >
      <style>{pdfTextLayerStyle}</style>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-center gap-1 bg-app-surface px-2 py-1">
        <Button
          aria-label={t(m.previousPdfPage)}
          disabled={!document || pageNumber <= 1}
          onClick={() => changePage(Math.max(1, pageNumber - 1))}
          size="icon"
          tone="ghost"
        >
          <Icon icon={ArrowLeft01Icon} />
        </Button>
        {document ? (
          <form
            className="flex items-center gap-1 text-xs text-app-muted"
            onSubmit={(event) => {
              event.preventDefault();
              commitPageInput();
            }}
          >
            <span className="sr-only">
              {t(m.pdfPageOfTotal, {
                page: pageNumber,
                total: document.numPages,
              })}
            </span>
            <span>Page</span>
            <input
              aria-label="PDF page number"
              className="h-7 w-12 rounded-md border border-input bg-card px-1.5 text-center text-xs tabular-nums text-app-ink outline-none transition-colors hover:border-border-hover focus:border-foreground focus:ring-2 focus:ring-ring"
              inputMode="numeric"
              onBlur={commitPageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPageInput(null);
                  event.currentTarget.blur();
                }
              }}
              type="text"
              value={displayedPageInput}
            />
            <span className="whitespace-nowrap">of {document.numPages}</span>
          </form>
        ) : (
          <span className="min-w-24 text-center text-xs text-app-muted">
            {t(m.pdfLoading)}
          </span>
        )}
        <Button
          aria-label={t(m.nextPdfPage)}
          disabled={!document || pageNumber >= document.numPages}
          onClick={() =>
            changePage(
              Math.min(document?.numPages ?? pageNumber, pageNumber + 1),
            )
          }
          size="icon"
          tone="ghost"
        >
          <Icon icon={ArrowRight01Icon} />
        </Button>
        <span className="mx-1 h-5 w-px bg-app-border" />
        <Button
          aria-label={t(m.zoomPdfOut)}
          disabled={scale <= 0.6}
          onClick={() => changeScale(Math.max(0.6, scale - 0.2))}
          size="icon"
          tone="ghost"
        >
          <Icon icon={ZoomOutAreaIcon} />
        </Button>
        <span
          aria-label="PDF zoom level"
          className="min-w-11 text-center text-xs tabular-nums text-app-muted"
        >
          {zoomPercent}%
        </span>
        <Button
          aria-label={t(m.zoomPdfIn)}
          disabled={scale >= 2}
          onClick={() => changeScale(Math.min(2, scale + 0.2))}
          size="icon"
          tone="ghost"
        >
          <Icon icon={ZoomInAreaIcon} />
        </Button>
        <Button
          disabled={atDefaultZoom}
          onClick={() => changeScale(1)}
          size="compact"
          title="Reset zoom"
          tone="ghost"
        >
          Fit width
        </Button>
      </div>
      <div
        aria-label="PDF page viewport"
        className="relative min-h-0 flex-1 overflow-auto p-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-focus"
        onScroll={(event) => {
          if (!readingPosition || rendering) return;
          readingPosition.scrollTop = event.currentTarget.scrollTop;
          readingPosition.scrollLeft = event.currentTarget.scrollLeft;
        }}
        ref={viewportRef}
        role="region"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard-focusable scroll region so keyboard users can scroll and page through it
        tabIndex={0}
      >
        {error ? (
          <p
            className="m-auto max-w-md py-10 text-center text-sm text-app-danger"
            role="alert"
          >
            {error}
          </p>
        ) : (
          <div className="relative mx-auto w-fit bg-white shadow-sm">
            <canvas
              aria-hidden={selectable || undefined}
              aria-label={
                selectable ? undefined : t(m.pdfPage, { page: pageNumber })
              }
              className="block"
              ref={canvasRef}
            />
            <div
              className="pdf-text-layer"
              onCopy={copyPageWords}
              ref={textLayerRef}
            />
          </div>
        )}
        {rendering && !error ? (
          <div
            className="absolute inset-0 flex items-center justify-center gap-2 bg-app-surface-soft/80 text-sm text-app-subtle"
            role="status"
          >
            <Spinner size={16} />
            {t(m.renderingPdf)}
          </div>
        ) : null}
      </div>
    </section>
  );
}
