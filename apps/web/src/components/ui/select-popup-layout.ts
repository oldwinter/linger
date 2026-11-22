const VIEWPORT_GUTTER_PX = 8;

interface PopupRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

export function selectPopupFrame(
  trigger: PopupRect,
  origin: { left: number; top: number; width: number; height: number } | null,
  viewport: { width: number; height: number },
): { trigger: PopupRect; viewport: { width: number; height: number } } {
  if (!origin) {
    return {
      trigger: {
        bottom: trigger.bottom,
        left: trigger.left,
        right: trigger.right,
        top: trigger.top,
        width: trigger.width,
      },
      viewport,
    };
  }
  return {
    trigger: {
      bottom: trigger.bottom - origin.top,
      left: trigger.left - origin.left,
      right: trigger.right - origin.left,
      top: trigger.top - origin.top,
      width: trigger.width,
    },
    viewport: { height: origin.height, width: origin.width },
  };
}

export function selectPopupContainingBlock(root: Element | null): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (!root || root === document.body || root === document.documentElement) {
    return null;
  }
  const rect = root.getBoundingClientRect();
  const style = window.getComputedStyle(root);
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
  return {
    height: rect.height - borderTop - borderBottom,
    left: rect.left + borderLeft,
    top: rect.top + borderTop,
    width: rect.width - borderLeft - borderRight,
  };
}

export interface SelectPopupPositionOptions {
  /**
   * "left" anchors to the trigger's left edge (default); "right" to its right
   * edge; "auto" picks the right edge when the trigger sits in the right half
   * of the viewport and the left edge otherwise.
   */
  readonly align?: "auto" | "left" | "right";
  /** Explicit popup width; defaults to the trigger's width. */
  readonly width?: number;
}

export function selectPopupPosition(
  trigger: PopupRect,
  viewport: { width: number; height: number },
  menuHeight?: number,
  options?: SelectPopupPositionOptions,
): { left: number; top: number; width: number } {
  const width = options?.width ?? trigger.width;
  const alignRight =
    options?.align === "right" ||
    (options?.align === "auto" &&
      trigger.left + trigger.width / 2 > viewport.width / 2);
  const preferredLeft = alignRight ? trigger.right - width : trigger.left;
  const maxLeft = Math.max(
    VIEWPORT_GUTTER_PX,
    viewport.width - width - VIEWPORT_GUTTER_PX,
  );
  const left = Math.min(Math.max(VIEWPORT_GUTTER_PX, preferredLeft), maxLeft);
  const below = trigger.bottom + 4;
  const height = menuHeight ?? 0;
  const fitsBelow =
    height === 0 || below + height <= viewport.height - VIEWPORT_GUTTER_PX;
  const top = fitsBelow
    ? below
    : Math.max(VIEWPORT_GUTTER_PX, trigger.top - height - 4);
  return { left, top, width };
}
