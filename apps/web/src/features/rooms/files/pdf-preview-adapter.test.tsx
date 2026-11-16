import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => {
  class TextLayer {
    options: {
      container: HTMLElement;
      textContentSource: { items?: { str?: string }[] };
    };

    constructor(options: TextLayer["options"]) {
      this.options = options;
      for (const item of options.textContentSource.items ?? []) {
        if (!item.str) continue;
        const span = document.createElement("span");
        span.textContent = item.str;
        options.container.append(span);
      }
    }

    render() {
      return Promise.resolve();
    }

    cancel() {}

    get textContentItemsStr() {
      return (this.options.textContentSource.items ?? []).map(
        (item) => item.str ?? "",
      );
    }
  }

  return {
    TextLayer,
    getDocument: vi.fn(),
    loadingDestroy: vi.fn(),
    renderCancel: vi.fn(),
    renderPage: vi.fn(),
    textItems: [] as { str: string }[],
  };
});
const resizeObservers: TestResizeObserver[] = [];

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  TextLayer: pdf.TextLayer,
  getDocument: pdf.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.mjs",
}));

import { PdfPreviewAdapter } from "./pdf-preview-adapter";

describe("PdfPreviewAdapter task lifecycle", () => {
  beforeEach(() => {
    pdf.textItems = [];
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    resizeObservers.length = 0;
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    pdf.renderPage.mockImplementation(() => ({
      cancel: pdf.renderCancel,
      promise: Promise.resolve(),
    }));
    const page = {
      getTextContent: vi.fn(async () => ({ items: pdf.textItems })),
      getViewport: ({ scale }: { scale: number }) => ({
        height: 900 * scale,
        scale,
        width: 600 * scale,
      }),
      render: pdf.renderPage,
    };
    const document = {
      getPage: vi.fn().mockResolvedValue(page),
      numPages: 2,
    };
    pdf.getDocument.mockReturnValue({
      destroy: pdf.loadingDestroy,
      promise: Promise.resolve(document),
    });
  });

  it("restores the saved page and zoom when the same version reopens", async () => {
    const readingPosition = { pageNumber: 1, scale: 1 };
    const blob = new Blob(["pdf"]);
    const view = render(
      <PdfPreviewAdapter
        blob={blob}
        filename="brief.pdf"
        readingPosition={readingPosition}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText("Rendering PDF...")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom PDF in" }));
    expect(readingPosition.pageNumber).toBe(2);
    expect(readingPosition.scale).toBe(1.2);
    view.unmount();
    render(
      <PdfPreviewAdapter
        blob={blob}
        filename="brief.pdf"
        readingPosition={readingPosition}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText("Rendering PDF...")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("PDF page 2")).toBeVisible();
    expect(screen.getByText("2 / 2")).toBeVisible();
  });

  it("puts the page's words on the picture and copies them as a sentence", async () => {
    pdf.textItems = [{ str: "The launch slipped." }];
    render(
      <PdfPreviewAdapter
        blob={new Blob(["%PDF-1.4\n%%EOF"])}
        filename="brief.pdf"
      />,
    );
    const line = await screen.findByText("The launch slipped.");
    expect(screen.queryByLabelText("PDF page 1")).not.toBeInTheDocument();

    const setData = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      anchorNode: line,
      toString: () => "The launch\0 slipped.",
    } as unknown as Selection);
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    line.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", "The launch slipped.");

    pdf.textItems = [{ str: "The next page." }];
    fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
    expect(await screen.findByText("The next page.")).toBeVisible();
    expect(screen.queryByText("The launch slipped.")).not.toBeInTheDocument();
    vi.mocked(document.getSelection).mockRestore();
  });

  it("does not rebuild tasks or flash Rendering for the same blob and viewport", async () => {
    const blob = new Blob(["%PDF-1.4\n%%EOF"]);
    const { rerender } = render(
      <PdfPreviewAdapter blob={blob} filename="brief.pdf" onError={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.queryByText("Rendering PDF...")).not.toBeInTheDocument(),
    );
    expect(pdf.getDocument).toHaveBeenCalledTimes(1);
    expect(pdf.renderPage).toHaveBeenCalledTimes(1);

    resizeObservers[0]?.notify(768);
    resizeObservers[0]?.notify(768);
    await Promise.resolve();
    expect(pdf.renderPage).toHaveBeenCalledTimes(1);

    rerender(
      <PdfPreviewAdapter blob={blob} filename="brief.pdf" onError={vi.fn()} />,
    );

    await Promise.resolve();
    expect(pdf.getDocument).toHaveBeenCalledTimes(1);
    expect(pdf.renderPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Rendering PDF...")).not.toBeInTheDocument();
  });

  it("cancels the old page task and creates one replacement on zoom", async () => {
    const pending = deferred<void>();
    pdf.renderPage
      .mockReturnValueOnce({
        cancel: pdf.renderCancel,
        promise: pending.promise,
      })
      .mockReturnValue({
        cancel: pdf.renderCancel,
        promise: Promise.resolve(),
      });
    render(
      <PdfPreviewAdapter
        blob={new Blob(["%PDF-1.4\n%%EOF"])}
        filename="brief.pdf"
      />,
    );
    await waitFor(() => expect(pdf.renderPage).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Zoom PDF in" }));

    await waitFor(() => expect(pdf.renderCancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pdf.renderPage).toHaveBeenCalledTimes(2));
    pending.resolve();
    fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
    await waitFor(() => expect(pdf.renderCancel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pdf.renderPage).toHaveBeenCalledTimes(3));
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }

  disconnect() {}
  observe() {}
  unobserve() {}

  notify(width: number) {
    this.callback([{ contentRect: { width } } as ResizeObserverEntry], this);
  }
}
