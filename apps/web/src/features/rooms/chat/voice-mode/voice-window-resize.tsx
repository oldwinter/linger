import {
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type RefObject,
} from "react";

import { useT } from "@/i18n/use-translation";
import { voiceWindowMessages as m } from "./voice-window.messages";

/** A voice window inside the page, in viewport pixels. */
export interface VoiceWindowRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** The part of the viewport a voice window may cover. */
export interface VoiceWindowBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface MinSize {
  height: number;
  width: number;
}

export type VoiceWindowEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const allEdges: readonly VoiceWindowEdge[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

// Each handle straddles the window's border, mostly outside it, so it does
// not cover a scrollbar or a control at the edge.
const handleClasses = {
  n: "inset-x-2 -top-1.5 h-2.5 cursor-ns-resize",
  s: "inset-x-2 -bottom-1.5 h-2.5 cursor-ns-resize",
  e: "inset-y-2 -right-1.5 w-2.5 cursor-ew-resize",
  w: "inset-y-2 -left-1.5 w-2.5 cursor-ew-resize",
  ne: "-top-1.5 -right-1.5 size-4 cursor-nesw-resize",
  nw: "-top-1.5 -left-1.5 size-4 cursor-nwse-resize",
  sw: "-bottom-1.5 -left-1.5 size-4 cursor-nesw-resize",
} satisfies Record<Exclude<VoiceWindowEdge, "se">, string>;

/**
 * Where the window is after `edge` moved by (dx, dy): the opposite edge stays
 * put, the window keeps at least `min` and stays inside `bounds`. A window
 * that already is smaller than `min` or reaches past `bounds` is never pushed
 * further that way.
 */
export function resizedVoiceWindowRect(
  start: VoiceWindowRect,
  edge: VoiceWindowEdge,
  dx: number,
  dy: number,
  min: MinSize,
  bounds: VoiceWindowBounds,
): VoiceWindowRect {
  let { left, top } = start;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  const minWidth = Math.min(min.width, start.width);
  const minHeight = Math.min(min.height, start.height);
  if (edge.includes("e"))
    right = Math.max(
      left + minWidth,
      Math.min(right + dx, Math.max(bounds.right, right)),
    );
  if (edge.includes("w"))
    left = Math.min(
      right - minWidth,
      Math.max(left + dx, Math.min(bounds.left, left)),
    );
  if (edge.includes("s"))
    bottom = Math.max(
      top + minHeight,
      Math.min(bottom + dy, Math.max(bounds.bottom, bottom)),
    );
  if (edge.includes("n"))
    top = Math.min(
      bottom - minHeight,
      Math.max(top + dy, Math.min(bounds.top, top)),
    );
  return { height: bottom - top, left, top, width: right - left };
}

/**
 * Where a window of `size` sits when it is moved to (left, top): no further
 * than keeps all of it inside `bounds`. A window larger than the bounds
 * starts at their top left, which keeps its header in view.
 */
export function containedVoiceWindowPosition(
  { left, top }: Pick<VoiceWindowRect, "left" | "top">,
  size: Pick<VoiceWindowRect, "height" | "width">,
  bounds: VoiceWindowBounds,
): Pick<VoiceWindowRect, "left" | "top"> {
  return {
    left: Math.max(bounds.left, Math.min(left, bounds.right - size.width)),
    top: Math.max(bounds.top, Math.min(top, bounds.bottom - size.height)),
  };
}

/**
 * Keeps an in-page voice window whole inside `bounds` while `enabled`: when
 * the viewport shrinks or the window grows, as it does when it opens from its
 * top row, `position` moves back in through `setPosition`. The window's size
 * on screen belongs to the position on screen, not to one a drag has asked
 * for and React has yet to draw, so this works from the position last drawn.
 * `width`, when given, stands in for the measured width, so a window easing
 * into a new width is kept in by the width it is going to.
 */
export function useKeptInViewport(
  frame: RefObject<HTMLElement | null>,
  position: Pick<VoiceWindowRect, "left" | "top"> | undefined,
  setPosition: (next: Pick<VoiceWindowRect, "left" | "top">) => void,
  bounds: () => VoiceWindowBounds,
  enabled: boolean,
  width?: number,
): void {
  const drawn = useRef({ bounds, position, setPosition });
  useLayoutEffect(() => {
    drawn.current = { bounds, position, setPosition };
  });
  useLayoutEffect(() => {
    const element = frame.current;
    if (!enabled || !element) return;
    const keepVisible = () => {
      const { bounds, position, setPosition } = drawn.current;
      if (!position) return;
      const next = containedVoiceWindowPosition(
        position,
        {
          height: element.offsetHeight,
          width: width ?? element.offsetWidth,
        },
        bounds(),
      );
      if (next.left !== position.left || next.top !== position.top)
        setPosition(next);
    };
    keepVisible();
    const observer = new ResizeObserver(keepVisible);
    observer.observe(element);
    window.addEventListener("resize", keepVisible);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepVisible);
    };
  }, [frame, enabled, width]);
}

/**
 * The edges and corners an in-page voice window is resized by. They sit on
 * the window's border, apart from the header that moves it. The bottom right
 * corner shows a grip and takes the keyboard: arrow keys resize in steps of
 * 8px, 32px with Shift.
 */
export function VoiceWindowResizeHandles({
  bounds,
  edges = allEdges,
  label,
  min,
  onResize,
  onResizeEnd,
  rect,
}: {
  /** Read when a resize starts, so it follows the viewport's size. */
  bounds: () => VoiceWindowBounds;
  /** A window minimized to one row is only as wide as the Human drags it. */
  edges?: readonly VoiceWindowEdge[];
  /** Names the grip, such as "Resize Voice Mode window". */
  label: string;
  min: MinSize;
  onResize: (rect: VoiceWindowRect) => void;
  onResizeEnd?: () => void;
  /** The window as it is on screen now. */
  rect: () => VoiceWindowRect | undefined;
}) {
  const t = useT();
  const drag = useRef<{
    bounds: VoiceWindowBounds;
    edge: VoiceWindowEdge;
    start: VoiceWindowRect;
    x: number;
    y: number;
  }>(undefined);
  const handlers = (edge: VoiceWindowEdge) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const start = rect();
      if (event.button !== 0 || !start) return;
      // Keeps the drag from selecting text in the page behind.
      event.preventDefault();
      // The pointer keeps this handle, and its cursor, wherever it goes.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = {
        bounds: bounds(),
        edge,
        start,
        x: event.clientX,
        y: event.clientY,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current) return;
      onResize(
        resizedVoiceWindowRect(
          current.start,
          current.edge,
          event.clientX - current.x,
          event.clientY - current.y,
          min,
          current.bounds,
        ),
      );
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  });
  function end() {
    if (!drag.current) return;
    drag.current = undefined;
    onResizeEnd?.();
  }
  return (
    <>
      {edges.map((edge) =>
        edge === "se" ? (
          <button
            aria-label={label}
            className="group absolute -right-1.5 -bottom-1.5 z-10 size-5 cursor-nwse-resize touch-none rounded-sm focus-visible:outline-none"
            data-resize-edge={edge}
            key={edge}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 32 : 8;
              const [dx, dy] =
                {
                  ArrowDown: [0, step],
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                }[event.key] ?? [];
              const start = rect();
              if (dx === undefined || dy === undefined || !start) return;
              event.preventDefault();
              onResize(
                resizedVoiceWindowRect(start, edge, dx, dy, min, bounds()),
              );
              onResizeEnd?.();
            }}
            title={t(m.resizeHint)}
            type="button"
            {...handlers(edge)}
          >
            <svg
              aria-hidden="true"
              className="absolute right-2.5 bottom-2.5 size-2 rounded-[1px] text-app-subtle opacity-70 group-hover:text-app-ink group-hover:opacity-100 group-focus-visible:text-app-ink group-focus-visible:opacity-100 group-focus-visible:shadow-[0_0_0_2px_var(--app-ring)]"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              viewBox="0 0 8 8"
            >
              <path d="M7.5 0.5 0.5 7.5M7.5 4 4 7.5" />
            </svg>
          </button>
        ) : (
          <div
            aria-hidden="true"
            className={`absolute z-10 touch-none ${handleClasses[edge]}`}
            data-resize-edge={edge}
            key={edge}
            {...handlers(edge)}
          />
        ),
      )}
    </>
  );
}
