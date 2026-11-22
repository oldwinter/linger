import { onTestFinished, vi } from "vitest";

import type {
  MermaidPreviewRequest,
  MermaidPreviewResponse,
} from "@/features/rooms/mermaid-preview-protocol";

/**
 * Stands in for the sandboxed Mermaid runtime, which jsdom cannot load: every
 * runtime frame the adapter appends reports ready and answers its render
 * request through the real message protocol, with the SVG `answer` returns or
 * the error it returns. Call it from a test or `beforeEach`; it stops when the
 * test finishes.
 */
export function serveMermaidRuntime(
  answer: (source: string) => string | Error,
) {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          node instanceof HTMLIFrameElement &&
          node.title === "Mermaid rendering runtime"
        )
          serveFrame(node);
      }
    }
  });
  observer.observe(document.body, { childList: true });
  onTestFinished(() => observer.disconnect());

  function serveFrame(frame: HTMLIFrameElement) {
    const runtime = frame.contentWindow!;
    const reply = (data: MermaidPreviewResponse) =>
      queueMicrotask(() =>
        window.dispatchEvent(
          new MessageEvent("message", { data, source: runtime }),
        ),
      );
    vi.spyOn(runtime, "postMessage").mockImplementation(((
      request: MermaidPreviewRequest,
    ) => {
      const result = answer(request.source);
      reply(
        result instanceof Error
          ? {
              error: result.message,
              kind: "linger.mermaid.error",
              requestId: request.requestId,
            }
          : {
              kind: "linger.mermaid.result",
              requestId: request.requestId,
              svg: result,
            },
      );
    }) as Window["postMessage"]);
    reply({ kind: "linger.mermaid.ready" });
  }
}
