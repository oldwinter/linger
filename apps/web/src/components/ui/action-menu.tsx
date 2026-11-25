import {
  ArrowRight01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/icon";

export type MenuPlacement =
  | "bottom-end"
  | "bottom-start"
  | "right-start"
  | "top-start";

export interface ActionMenuItem {
  children?: ActionMenuItem[];
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** Stays open after selection, for an action that can fail and be retried. */
  keepOpen?: boolean;
  label: string;
  onSelect?: () => void;
  separatorBefore?: boolean;
  /**
   * What Voice Mode risks by clicking the item, as `data-voice-risk` (see
   * voice-ui-bridge): "confirm" asks the Human first, "never" also keeps it
   * out of spoken commands.
   */
  voiceRisk?: "confirm" | "never";
}

export function ActionMenu({
  buttonClassName = "flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  header,
  followAnchor = false,
  openOnHover = false,
  onTriggerClick,
  initialFocusIndex = 0,
  placement = "bottom-end",
  iconClassName = "flex size-4 shrink-0 items-center justify-center",
  itemClassName = "flex min-h-[33px] w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50",
  items,
  label,
  menuClassName = "app-popover-card fixed z-[100] w-[232px] p-1",
  trigger = <Icon icon={MoreHorizontalIcon} size={16} />,
}: {
  buttonClassName?: string;
  header?: ReactNode;
  followAnchor?: boolean;
  openOnHover?: boolean;
  onTriggerClick?: () => void;
  initialFocusIndex?: number;
  placement?: MenuPlacement;
  iconClassName?: string;
  itemClassName?: string;
  items: ActionMenuItem[];
  label: string;
  menuClassName?: string;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [focusOnOpen, setFocusOnOpen] = useState(true);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [activeSubmenu, setActiveSubmenu] = useState<number | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [menuSide, setMenuSide] = useState<"bottom" | "right" | "top">(
    "bottom",
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function cancelHoverClose() {
    clearTimeout(hoverCloseTimer.current);
  }
  function scheduleHoverClose() {
    if (!openOnHover) return;
    cancelHoverClose();
    hoverCloseTimer.current = setTimeout(() => {
      if (
        !menuRef.current?.contains(document.activeElement) &&
        !submenuRef.current?.contains(document.activeElement)
      )
        setOpen(false);
    }, 150);
  }
  useEffect(() => () => clearTimeout(hoverCloseTimer.current), []);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      const next = computeMenuPosition(
        triggerRect,
        menuSize(menuRef.current),
        placement,
      );
      setPosition(next);
      setMenuSide(
        placement === "right-start"
          ? "right"
          : next.top < triggerRect.top
            ? "top"
            : "bottom",
      );
    };
    updatePosition();
    if (followAnchor) {
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
    }
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updatePosition);
    if (menuRef.current) observer?.observe(menuRef.current);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      observer?.disconnect();
    };
  }, [open, placement, followAnchor]);

  useEffect(() => {
    if (!open || !focusOnOpen) return;
    const frame = requestAnimationFrame(() => {
      const preferred = itemRefs.current[initialFocusIndex];
      const target =
        preferred && !preferred.disabled
          ? preferred
          : itemRefs.current.find((item) => item && !item.disabled);
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusOnOpen, initialFocusIndex]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target) &&
        !submenuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnViewportLayoutChange = (event?: Event) => {
      if (followAnchor) return;
      if (event?.type === "scroll" && !isViewportScrollTarget(event.target)) {
        return;
      }
      setOpen(false);
    };
    const closeHoverOnEscape = (event: globalThis.KeyboardEvent) => {
      if (
        openOnHover &&
        event.key === "Escape" &&
        !menuRef.current?.contains(event.target as Node) &&
        !submenuRef.current?.contains(event.target as Node)
      ) {
        event.preventDefault();
        setActiveSubmenu(null);
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeHoverOnEscape);
    window.addEventListener("resize", closeOnViewportLayoutChange);
    window.addEventListener("scroll", closeOnViewportLayoutChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeHoverOnEscape);
      window.removeEventListener("resize", closeOnViewportLayoutChange);
      window.removeEventListener("scroll", closeOnViewportLayoutChange, true);
    };
  }, [open, followAnchor, openOnHover]);

  function closeMenu() {
    setActiveSubmenu(null);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    moveMenuFocus(event);
  }

  const hasIcons = items.some((item) => item.icon !== undefined);
  const submenuItems =
    activeSubmenu === null ? undefined : items[activeSubmenu]?.children;

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={buttonClassName}
        onPointerEnter={(event) => {
          if (!openOnHover || event.pointerType === "touch") return;
          cancelHoverClose();
          if (!open) {
            setFocusOnOpen(false);
            setOpen(true);
          }
        }}
        onPointerLeave={scheduleHoverClose}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cancelHoverClose();
          if (onTriggerClick) {
            closeMenu();
            onTriggerClick();
            return;
          }
          setFocusOnOpen(true);
          setOpen((current) => !current);
          setActiveSubmenu(null);
        }}
        ref={triggerRef}
        type="button"
      >
        {trigger}
      </button>
      {open
        ? createPortal(
            <>
              {/* A hover-opened menu skips the scrim: it would cover the
                  trigger, fire pointerleave and close the menu in a loop. */}
              {openOnHover ? null : (
                <div
                  aria-hidden="true"
                  className="app-menu-scrim"
                  onPointerDown={() => closeMenu()}
                />
              )}
              {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- composite widget: focus is managed on its child items */}
              <div
                aria-label={label}
                className={`town-dropdown-enter max-w-[calc(100vw-16px)] ${menuClassName}`}
                data-side={menuSide}
                onPointerEnter={cancelHoverClose}
                onPointerLeave={scheduleHoverClose}
                onKeyDown={handleKeyDown}
                ref={menuRef}
                role="menu"
                style={position}
              >
                <div
                  className="workspace-scrollbar max-h-[min(28rem,calc(100dvh-32px))] overflow-x-hidden overflow-y-auto overscroll-contain"
                  onScroll={() => setActiveSubmenu(null)}
                >
                  {header ? (
                    <div className="-mx-1 mb-1 border-b border-border px-3 py-2">
                      {header}
                    </div>
                  ) : null}
                  {items.map((item, index) => (
                    <ActionMenuItemButton
                      className={itemClassName}
                      hasIcons={hasIcons}
                      iconClassName={iconClassName}
                      item={item}
                      key={item.label}
                      onOpenSubmenu={(focusFirstChild) => {
                        setActiveSubmenu(index);
                        if (!focusFirstChild) return;
                        requestAnimationFrame(() =>
                          submenuRef.current
                            ?.querySelector<HTMLButtonElement>(
                              '[role="menuitem"]:not(:disabled)',
                            )
                            ?.focus(),
                        );
                      }}
                      onSelect={() => {
                        if (!item.keepOpen) {
                          closeMenu();
                          triggerRef.current?.focus();
                        }
                        item.onSelect?.();
                      }}
                      ref={(node) => {
                        itemRefs.current[index] = node;
                      }}
                      submenuOpen={activeSubmenu === index}
                    />
                  ))}
                </div>
              </div>
              {submenuItems ? (
                <ActionSubmenu
                  anchor={itemRefs.current[activeSubmenu ?? -1] ?? null}
                  items={submenuItems}
                  label={items[activeSubmenu ?? -1]?.label}
                  onBack={() => {
                    const parentIndex = activeSubmenu;
                    setActiveSubmenu(null);
                    itemRefs.current[parentIndex ?? -1]?.focus();
                  }}
                  onClose={closeMenu}
                  onPointerEnter={cancelHoverClose}
                  onPointerLeave={scheduleHoverClose}
                  parentMenu={menuRef.current}
                  parentPosition={position}
                  ref={submenuRef}
                />
              ) : null}
            </>,
            // A modal dialog makes everything outside it inert, so a menu for a
            // trigger inside one stays in the dialog to be visible and clickable.
            triggerRef.current?.closest("dialog[open]") ?? document.body,
          )
        : null}
    </>
  );
}

function isViewportScrollTarget(target: EventTarget | null): boolean {
  return (
    target === window ||
    target === document ||
    target === document.documentElement ||
    target === document.body
  );
}

function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const enabled = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  );
  const current = enabled.findIndex((item) => item === document.activeElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabled.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) %
          enabled.length;
  enabled[next]?.focus();
}

function menuSize(menu: HTMLElement | null) {
  if (!menu) return undefined;
  const bounds = menu.getBoundingClientRect();
  // Layout dimensions do not shrink during the menu's entrance animation.
  return {
    width: menu.offsetWidth || bounds.width,
    height: menu.offsetHeight || bounds.height,
  };
}

/** One gap between a menu and its trigger; one margin to the viewport edge. */
const MENU_GAP = 6;
const MENU_MARGIN = 8;

function computeMenuPosition(
  triggerRect: DOMRect,
  menuRect: Pick<DOMRect, "width" | "height"> | undefined,
  placement: MenuPlacement,
) {
  const width = menuRect?.width ?? 232;
  const height = menuRect?.height ?? 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampLeft = (left: number) =>
    Math.max(MENU_MARGIN, Math.min(left, vw - width - MENU_MARGIN));
  const clampTop = (top: number) =>
    Math.max(MENU_MARGIN, Math.min(top, vh - height - MENU_MARGIN));

  if (placement === "right-start") {
    const right = triggerRect.right + MENU_GAP;
    const sideLeft =
      right + width <= vw - MENU_MARGIN
        ? right
        : Math.max(MENU_MARGIN, triggerRect.left - width - MENU_GAP);
    return { left: clampLeft(sideLeft), top: clampTop(triggerRect.top) };
  }
  if (placement === "top-start") {
    const above = triggerRect.top - MENU_GAP - height;
    const top =
      height > 0 && above < MENU_MARGIN ? triggerRect.bottom + MENU_GAP : above;
    return { left: clampLeft(triggerRect.left), top: clampTop(top) };
  }
  const left = clampLeft(
    placement === "bottom-start" ? triggerRect.left : triggerRect.right - width,
  );
  const below = triggerRect.bottom + MENU_GAP;
  const top =
    height > 0 && below + height > vh - MENU_MARGIN
      ? Math.max(MENU_MARGIN, triggerRect.top - height - MENU_GAP)
      : below;
  return { left, top: clampTop(top) };
}

function ActionMenuItemButton({
  className,
  hasIcons,
  iconClassName,
  item,
  onOpenSubmenu,
  onSelect,
  ref,
  submenuOpen,
}: {
  className: string;
  hasIcons: boolean;
  iconClassName: string;
  item: ActionMenuItem;
  onOpenSubmenu: (focusFirstChild: boolean) => void;
  onSelect: () => void;
  ref: Ref<HTMLButtonElement>;
  submenuOpen: boolean;
}) {
  return (
    <div>
      {item.separatorBefore ? (
        <div className="-mx-1 my-1 border-t border-border" role="separator" />
      ) : null}
      <button
        aria-expanded={item.children ? submenuOpen : undefined}
        aria-haspopup={item.children ? "menu" : undefined}
        className={`${className} ${
          item.danger ? "text-destructive" : "text-foreground"
        }`}
        data-voice-risk={item.voiceRisk}
        disabled={item.disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (item.children) {
            onOpenSubmenu(false);
            return;
          }
          onSelect();
        }}
        onKeyDown={(event) => {
          if (
            item.children &&
            (event.key === "ArrowRight" ||
              event.key === "Enter" ||
              event.key === " ")
          ) {
            event.preventDefault();
            event.stopPropagation();
            onOpenSubmenu(true);
          }
        }}
        onPointerEnter={() => {
          if (item.children) onOpenSubmenu(false);
        }}
        ref={ref}
        role="menuitem"
        tabIndex={-1}
        type="button"
      >
        {hasIcons ? (
          <span
            className={`${iconClassName} ${item.danger ? "" : "text-muted-foreground"}`}
          >
            {item.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate" title={item.label}>
          {item.label}
        </span>
        {item.children ? (
          <Icon
            className="ml-auto text-muted-foreground"
            icon={ArrowRight01Icon}
            size={14}
          />
        ) : null}
      </button>
    </div>
  );
}

function ActionSubmenu({
  anchor,
  items,
  label,
  onBack,
  onClose,
  onPointerEnter,
  onPointerLeave,
  parentMenu,
  parentPosition,
  ref,
}: {
  anchor: HTMLButtonElement | null;
  items: ActionMenuItem[];
  label?: string;
  onBack: () => void;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  parentMenu: HTMLDivElement | null;
  parentPosition: Pick<DOMRect, "left" | "top">;
  ref: RefObject<HTMLDivElement | null>;
}) {
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const updatePosition = useEffectEvent(() => {
    if (!anchor || !parentMenu) return;
    const parentBounds = parentMenu.getBoundingClientRect();
    const anchorBounds = anchor.getBoundingClientRect();
    const next = computeMenuPosition(
      new DOMRect(
        parentBounds.left,
        anchorBounds.top,
        parentBounds.width,
        anchorBounds.height,
      ),
      menuSize(ref.current),
      "right-start",
    );
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  });
  useLayoutEffect(() => {
    updatePosition();
  }, [anchor, parentMenu, parentPosition]);
  useLayoutEffect(() => {
    const update = () => updatePosition();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    if (ref.current) observer?.observe(ref.current);
    if (parentMenu) {
      observer?.observe(parentMenu);
      parentMenu.addEventListener("animationend", update);
    }
    return () => {
      observer?.disconnect();
      parentMenu?.removeEventListener("animationend", update);
    };
  }, [parentMenu, ref]);

  const hasIcons = items.some((child) => child.icon !== undefined);

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- composite widget: focus is managed on its child items
    <div
      aria-label={label}
      className="app-popover-card workspace-scrollbar fixed z-[101] max-h-[min(28rem,calc(100dvh-16px))] w-[180px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain p-1"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onBack();
          return;
        }
        if (event.key === "Tab") onClose();
        moveMenuFocus(event);
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      ref={ref}
      role="menu"
      style={position}
    >
      {items.map((child) => (
        <div key={child.label}>
          {child.separatorBefore ? (
            <div
              className="-mx-1 my-1 border-t border-border"
              role="separator"
            />
          ) : null}
          <button
            className={`flex min-h-[33px] w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50 ${
              child.danger ? "text-destructive" : "text-foreground"
            }`}
            data-voice-risk={child.voiceRisk}
            disabled={child.disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!child.keepOpen) onClose();
              child.onSelect?.();
            }}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            {hasIcons ? (
              <span
                className={`flex size-4 shrink-0 items-center justify-center ${
                  child.danger ? "" : "text-muted-foreground"
                }`}
              >
                {child.icon}
              </span>
            ) : null}
            <span className="min-w-0 truncate" title={child.label}>
              {child.label}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
