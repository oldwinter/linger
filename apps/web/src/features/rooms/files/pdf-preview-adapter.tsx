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
import type { ArtifactReadingPosition } from "./artifact-preview-cache";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerTask = useRef<TextLayer | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  const [pageNumber, setPageNumber] = useState(
    readingPosition?.pageNumber ?? 1,
  );
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
          throw new Error(
            `This PDF has more than ${maxPdfPages} pages and exceeds the basic preview limit.`,
          );
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
            ? `PDF preview failed: ${loadError.message}`
            : "PDF preview failed for this file.";
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
        if (!context) throw new Error("Canvas rendering is unavailable.");
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
            ? `PDF page rendering failed: ${renderError.message}`
            : "PDF page rendering failed.";
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
    if (readingPosition) {
      readingPosition.pageNumber = next;
      readingPosition.scrollTop = 0;
      readingPosition.scrollLeft = 0;
    }
    setPageNumber(next);
  }

  function changeScale(next: number) {
    if (readingPosition) readingPosition.scale = next;
    setScale(next);
  }

  return (
    <section
      aria-label={`PDF preview ${filename}`}
      className="flex h-full min-h-[420px] flex-col bg-app-surface-soft"
      role="document"
    >
      <style>{pdfTextLayerStyle}</style>
      <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-b border-app-border bg-app-surface px-2">
        <Button
          aria-label="Previous PDF page"
          disabled={!document || pageNumber <= 1}
          onClick={() => changePage(Math.max(1, pageNumber - 1))}
          size="icon"
          tone="ghost"
        >
          <Icon icon={ArrowLeft01Icon} />
        </Button>
        <span className="min-w-24 text-center text-xs text-app-muted">
          {document ? `${pageNumber} / ${document.numPages}` : "Loading"}
        </span>
        <Button
          aria-label="Next PDF page"
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
          aria-label="Zoom PDF out"
          disabled={scale <= 0.6}
          onClick={() => changeScale(Math.max(0.6, scale - 0.2))}
          size="icon"
          tone="ghost"
        >
          <Icon icon={ZoomOutAreaIcon} />
        </Button>
        <Button
          aria-label="Zoom PDF in"
          disabled={scale >= 2}
          onClick={() => changeScale(Math.min(2, scale + 0.2))}
          size="icon"
          tone="ghost"
        >
          <Icon icon={ZoomInAreaIcon} />
        </Button>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-auto p-6"
        onScroll={(event) => {
          if (!readingPosition || rendering) return;
          readingPosition.scrollTop = event.currentTarget.scrollTop;
          readingPosition.scrollLeft = event.currentTarget.scrollLeft;
        }}
        ref={viewportRef}
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
              aria-label={selectable ? undefined : `PDF page ${pageNumber}`}
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
            Rendering PDF...
          </div>
        ) : null}
      </div>
    </section>
  );
}
