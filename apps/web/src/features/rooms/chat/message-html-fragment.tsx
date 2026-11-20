import {
  Copy01Icon,
  Download04Icon,
  MoreHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Icon } from "@/components/ui/icon";

import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";

import {
  appFontFaces,
  currentFragmentTheme,
  fragmentDownloadFileName,
  hostedFragmentDocument,
  htmlFragmentSizeMessageType,
} from "./html-fragment-host";

const minFragmentHeight = 48;

function downloadFragmentFile(title: string, html: string) {
  const isSvg = /^\s*<svg[\s>]/i.test(html);
  const blob = new Blob([html], {
    type: isSvg ? "image/svg+xml;charset=utf-8" : "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fragmentDownloadFileName(title, html);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function MessageHtmlFragment({
  html,
  title,
}: {
  html: string;
  title: string;
}) {
  // The fragment takes the app's theme values, so its colors and font match.
  const source = useMemo(
    () => hostedFragmentDocument(html, currentFragmentTheme(), appFontFaces()),
    [html],
  );
  return <HtmlFragmentFrame source={source} title={title} widgetHtml={html} />;
}

export function HtmlFragmentFrame({
  source,
  title,
  widgetHtml,
}: {
  source: string;
  title: string;
  widgetHtml: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(minFragmentHeight);
  // The width cap the fragment declares, if any; otherwise the chat width.
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  // Each fragment is a script-running document. Create it only when it nears
  // the viewport, so a long history does not start every widget at once.
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const host = hostRef.current;
    if (nearViewport || !host) return;
    // rootMargin only widens the root's own box, so the timeline scroller
    // must be the root; with the page viewport the margin would be clipped.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setNearViewport(true);
        }
      },
      { root: scrollingAncestor(host), rootMargin: "600px 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [nearViewport]);

  // A fragment that loads above the visible area grows the content under it;
  // keep what the reader is looking at in place, as browser scroll anchoring
  // is off in the timeline.
  const renderedHeightRef = useRef(height);
  useLayoutEffect(() => {
    const delta = height - renderedHeightRef.current;
    renderedHeightRef.current = height;
    const host = hostRef.current;
    if (!delta || !host) return;
    const scroller = scrollingAncestor(host);
    if (!scroller) return;
    const previousBottom = host.getBoundingClientRect().bottom - delta;
    if (previousBottom <= scroller.getBoundingClientRect().top) {
      scroller.scrollTop += delta;
    }
  }, [height]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (
        !event.data ||
        event.data.type !== htmlFragmentSizeMessageType ||
        typeof event.data.height !== "number"
      ) {
        return;
      }
      setHeight(Math.max(minFragmentHeight, Math.ceil(event.data.height)));
      const width = event.data.width;
      setContentWidth(
        typeof width === "number" && width > 0 ? Math.ceil(width) : null,
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div
      // An explicit width, the chat card width like every other card: the
      // Message column shrinks to fit, so a percentage alone would leave the
      // frame at an iframe's default 300px. A fragment that caps its own
      // width narrower gets a frame that hugs it (plus the 1px border on
      // each side).
      className="group relative my-2 max-w-full"
      ref={hostRef}
      style={{
        width: contentWidth
          ? `min(${contentWidth + 2}px, var(--chat-card-width))`
          : "var(--chat-card-width)",
      }}
    >
      {nearViewport ? (
        <iframe
          className="block w-full rounded-xl border border-app-border bg-app-surface shadow-[var(--chat-card-shadow)]"
          data-html-fragment=""
          ref={frameRef}
          sandbox="allow-scripts"
          srcDoc={source}
          // The reported height is the content's; the 1px border on each side
          // comes on top, so the fragment shows in full without a scrollbar.
          style={{ height: height + 2 }}
          title={title}
        />
      ) : (
        <div
          aria-label={title}
          className="w-full rounded-xl border border-app-border bg-app-surface shadow-[var(--chat-card-shadow)]"
          data-html-fragment-placeholder=""
          role="img"
          style={{ height: height + 2 }}
        />
      )}
      <FragmentHostActions html={widgetHtml} title={title} />
    </div>
  );
}

function scrollingAncestor(element: HTMLElement) {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

const copiedFeedbackMs = 1200;

function FragmentHostActions({ html, title }: { html: string; title: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  function handleCopy() {
    window.clearTimeout(resetTimerRef.current);
    setCopyState("idle");
    void writeClipboardText(html).then(
      () => {
        setCopyState("copied");
        resetTimerRef.current = window.setTimeout(
          () => setCopyState("idle"),
          copiedFeedbackMs,
        );
      },
      () => {
        setCopyState("failed");
      },
    );
  }

  return (
    <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
      {copyState !== "idle" ? (
        <span
          className={cn(
            "rounded-md border bg-app-surface px-2 py-1 text-xs font-medium shadow-sm",
            copyState === "copied"
              ? "border-app-border text-app-ink"
              : "border-app-danger/40 text-app-danger",
          )}
          role={copyState === "failed" ? "alert" : "status"}
        >
          {copyState === "copied" ? "Copied" : "Copy failed"}
        </span>
      ) : null}
      <ActionMenu
        buttonClassName="flex size-7 items-center justify-center rounded-md border border-transparent bg-app-surface text-app-muted opacity-0 shadow-sm transition-opacity hover:bg-app-hover hover:text-app-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
        itemClassName="flex min-h-[33px] w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50"
        items={[
          {
            icon: (
              <Icon
                icon={copyState === "copied" ? Tick02Icon : Copy01Icon}
                size={14}
              />
            ),
            label: copyState === "copied" ? "Copied" : "Copy to clipboard",
            onSelect: handleCopy,
          },
          {
            icon: <Icon icon={Download04Icon} size={14} />,
            label: "Download file",
            onSelect: () => downloadFragmentFile(title, html),
          },
        ]}
        label="Widget actions"
        menuClassName="app-popover-card fixed z-[100] w-max min-w-[12rem] p-1"
        trigger={<Icon icon={MoreHorizontalIcon} size={16} />}
      />
    </div>
  );
}
