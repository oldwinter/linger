import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { chatMessages } from "./chat.messages";

export interface InlineMermaidBlockProps {
  code: string;
  copied: boolean;
  copyLabel: string;
  lineCount: number;
  onCopy: () => void;
}

type MermaidViewMode = "code" | "diagram";

type RenderState =
  | { kind: "error" }
  | { kind: "loading" }
  | { kind: "ready"; svg: string };

const MAX_MERMAID_SOURCE_LENGTH = 50_000;

/**
 * Lazy-loaded inline Mermaid diagram renderer for fenced `mermaid` code blocks
 * in chat messages. Sanitizes SVG via DOMPurify, offers a Diagram / Code
 * toggle, and falls back gracefully to source code on syntax or DOM errors.
 */
export function InlineMermaidBlock({
  code,
  copied,
  copyLabel,
  lineCount,
  onCopy,
}: InlineMermaidBlockProps) {
  const t = useT();
  const renderKey = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [mode, setMode] = useState<MermaidViewMode>("diagram");
  const [state, setState] = useState<RenderState>({ kind: "loading" });
  const svgHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    async function renderDiagram() {
      const trimmed = code.trim();
      if (
        !trimmed ||
        trimmed.length > MAX_MERMAID_SOURCE_LENGTH ||
        typeof document === "undefined" ||
        typeof DOMParser === "undefined"
      ) {
        if (!cancelled) setState({ kind: "error" });
        return;
      }
      try {
        const [{ default: mermaid }, { default: DOMPurify }] =
          await Promise.all([import("mermaid"), import("dompurify")]);
        if (cancelled) return;
        const dark =
          typeof document !== "undefined" &&
          document.documentElement.dataset.theme === "dark";
        mermaid.initialize({
          htmlLabels: false,
          maxTextSize: MAX_MERMAID_SOURCE_LENGTH,
          securityLevel: "strict",
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
        });
        await mermaid.parse(trimmed);
        if (cancelled) return;
        const { svg } = await mermaid.render(
          `chat-mermaid-${renderKey}`,
          trimmed,
        );
        if (cancelled) return;
        const sanitized = DOMPurify.sanitize(svg, {
          FORBID_TAGS: ["foreignObject", "script"],
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        if (!sanitized || !sanitized.includes("<svg")) {
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "ready", svg: sanitized });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code, renderKey]);

  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    if (mode !== "diagram" || state.kind !== "ready") {
      host.replaceChildren();
      return;
    }
    const parsed = new DOMParser().parseFromString(state.svg, "image/svg+xml");
    const svgNode = parsed.querySelector("svg");
    if (!svgNode || parsed.querySelector("parsererror")) {
      host.replaceChildren();
      setState({ kind: "error" });
      return;
    }
    host.replaceChildren(document.importNode(svgNode, true));
  }, [mode, state]);

  const showSource = mode === "code" || state.kind === "error";

  return (
    <div
      className="message-code-block message-mermaid-block"
      data-testid="inline-mermaid-block"
    >
      <div className="message-code-header">
        <div className="message-code-meta">
          <span className="message-code-lang">
            {t(chatMessages.mermaidLabel)}
          </span>
          <span className="message-code-lines">
            {t(chatMessages.codeLineCount, { count: lineCount })}
          </span>
        </div>
        <div className="message-code-actions">
          <div
            aria-label={t(chatMessages.mermaidViewToggle)}
            className="message-mermaid-toggle"
            role="group"
          >
            <button
              aria-pressed={mode === "diagram"}
              className={cn(
                "message-mermaid-toggle-btn",
                mode === "diagram" && "is-active",
              )}
              onClick={() => setMode("diagram")}
              type="button"
            >
              {t(chatMessages.mermaidDiagram)}
            </button>
            <button
              aria-pressed={mode === "code"}
              className={cn(
                "message-mermaid-toggle-btn",
                mode === "code" && "is-active",
              )}
              onClick={() => setMode("code")}
              type="button"
            >
              {t(chatMessages.mermaidCode)}
            </button>
          </div>
          <button
            aria-label={copyLabel}
            className="message-code-action-btn"
            onClick={onCopy}
            title={copyLabel}
            type="button"
          >
            <Icon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
          </button>
        </div>
      </div>

      {showSource ? (
        <>
          {mode === "diagram" && state.kind === "error" ? (
            <p className="message-mermaid-fallback" role="status">
              {t(chatMessages.mermaidFallbackNotice)}
            </p>
          ) : null}
          <pre>
            <code className="language-mermaid">{code}</code>
          </pre>
        </>
      ) : (
        <div className="message-mermaid-body">
          {state.kind === "loading" ? (
            <p className="message-mermaid-loading" role="status">
              {t(chatMessages.mermaidRendering)}
            </p>
          ) : null}
          <div
            aria-label={t(chatMessages.mermaidDiagram)}
            className={cn(
              "message-mermaid-canvas",
              state.kind !== "ready" && "hidden",
            )}
            ref={svgHostRef}
            role="img"
          />
        </div>
      )}
    </div>
  );
}
