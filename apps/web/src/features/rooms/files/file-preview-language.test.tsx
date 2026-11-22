import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import {
  createDocumentTestRuntime,
  seedRoomUpload,
} from "@/test/document-scenarios";
import { MermaidSvgPreview } from "../mermaid-svg-preview";
import { ArtifactPreviewSurface } from "./artifact-preview-surface";
import { DataPreviewAdapter } from "./data-preview-adapter";
import {
  type DataPreviewRequest,
  dataPreviewLimits,
} from "./data-preview-protocol";
import { PdfPreviewAdapter } from "./pdf-preview-adapter";

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.mjs",
}));

const preview = zhCN.filePreview;
const mermaid = zhCN.mermaidPreview;

class TestResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

function surface(
  runtime: ReturnType<typeof createDocumentTestRuntime>,
  node: TeamHubDocument,
  fullScreen: boolean,
) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <ArtifactPreviewSurface
          fullScreen={fullScreen}
          node={node}
          onClose={vi.fn()}
          onToggleFullScreen={vi.fn()}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>
  );
}

function stubDataPreviewWorkers() {
  const workers: (EventTarget & { request?: DataPreviewRequest })[] = [];
  vi.stubGlobal(
    "Worker",
    class extends EventTarget {
      request?: DataPreviewRequest;
      constructor() {
        super();
        workers.push(this);
      }
      postMessage(request: DataPreviewRequest) {
        this.request = request;
      }
      terminate() {}
    },
  );
  return workers;
}

describe("File previews in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("names the preview header controls in Chinese and marks the close button", async () => {
    await setLanguage("zh-CN");
    const runtime = createDocumentTestRuntime();
    const node = await seedRoomUpload(runtime, "preview-markdown", {
      file: new File(["# Product V0"], "product-v0-brief.md", {
        type: "text/markdown",
      }),
      representationFormat: "markdown",
    });
    const view = render(surface(runtime, node, false));

    expect(
      await screen.findByRole("button", {
        name: preview.downloadFile.replace("{name}", node.title),
      }),
    ).toBeEnabled();
    const versionPrefix = preview.versionDetails.split("{version}")[0]!;
    expect(
      screen.getByText((text) => text.startsWith(versionPrefix)),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: preview.openFullScreen }),
    ).toHaveAttribute("title", preview.fullScreen);
    const close = screen.getByRole("button", {
      name: preview.closeFilePreview,
    });
    expect(close).toHaveAttribute("data-voice-close");
    expect(close).toHaveAttribute("title", zhCN.common.close);

    view.rerender(surface(runtime, node, true));
    expect(
      screen.getByRole("button", { name: preview.exitFullScreen }),
    ).toBeVisible();
  });

  it("counts rows and columns of a data preview in Chinese", async () => {
    await setLanguage("zh-CN");
    const workers = stubDataPreviewWorkers();
    render(
      <DataPreviewAdapter
        blob={new Blob(["a,b\n1,2\n3,4"])}
        filename="data.csv"
        mediaType="text/csv"
      />,
    );
    const worker = workers[0]!;
    act(() => {
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: {
            kind: "parsed",
            requestId: worker.request!.requestId,
            rows: [
              ["a", "b"],
              ["1", "2"],
              ["3", "4"],
            ],
            truncated: true,
            truncation: "rows",
          },
        }),
      );
    });

    const table = screen.getByRole("table", {
      name: preview.dataPreviewLabel.replace("{name}", "data.csv"),
    });
    expect(table).toHaveTextContent(
      preview.dataRows.other.replace("{count}", "3"),
    );
    expect(table).toHaveTextContent(
      preview.dataColumns.other.replace("{count}", "2"),
    );
    expect(table).toHaveTextContent(
      preview.dataOnlyFirstRows.other.replace("{count}", "10,000"),
    );
  });

  it("words a failed data preview again when the language changes", async () => {
    const workers = stubDataPreviewWorkers();
    const onError = vi.fn();
    render(
      <DataPreviewAdapter
        blob={new Blob(["a,b\n1,2"])}
        filename="data.csv"
        mediaType="text/csv"
        onError={onError}
      />,
    );
    const worker = workers[0]!;
    act(() => {
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: {
            kind: "failed",
            requestId: worker.request!.requestId,
            failure: { code: "cellTooLarge" },
          },
        }),
      );
    });
    const kibibytes = String(dataPreviewLimits.maxCellCharacters / 1024);
    expect(screen.getByRole("alert")).toHaveTextContent(
      `A cell exceeds the ${kibibytes} KiB basic preview limit.`,
    );

    await act(() => setLanguage("zh-CN"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      preview.dataCellTooLarge.replace("{kibibytes}", kibibytes),
    );
    expect(onError).toHaveBeenCalledOnce();
  });

  it("names the PDF controls and page count in Chinese", async () => {
    await setLanguage("zh-CN");
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({
        height: 900 * scale,
        width: 600 * scale,
      }),
      render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
    };
    pdf.getDocument.mockReturnValue({
      destroy: vi.fn(),
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue(page),
        numPages: 2,
      }),
    });
    render(<PdfPreviewAdapter blob={new Blob(["pdf"])} filename="brief.pdf" />);

    expect(
      screen.getByRole("document", {
        name: preview.pdfPreview.replace("{name}", "brief.pdf"),
      }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText(preview.renderingPdf)).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        preview.pdfPageOfTotal.replace("{page}", "1").replace("{total}", "2"),
      ),
    ).toBeVisible();
    expect(
      screen.getByLabelText(preview.pdfPage.replace("{page}", "1")),
    ).toBeVisible();
    for (const name of [
      preview.previousPdfPage,
      preview.nextPdfPage,
      preview.zoomPdfOut,
      preview.zoomPdfIn,
    ])
      expect(screen.getByRole("button", { name })).toBeVisible();
  });

  it("names the Mermaid zoom controls in Chinese", async () => {
    await setLanguage("zh-CN");
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    render(
      <MermaidSvgPreview
        svg='<svg viewBox="0 0 100 50"></svg>'
        title="diagram.mmd"
      />,
    );

    expect(
      screen.getByRole("group", { name: mermaid.zoomToolbar }),
    ).toBeVisible();
    for (const name of [
      mermaid.zoomDiagramOut,
      mermaid.zoomDiagramIn,
      mermaid.fitDiagram,
    ])
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "title",
        name,
      );
    expect(
      screen.getByRole("region", { name: mermaid.diagramCanvas }),
    ).toBeVisible();
  });
});
