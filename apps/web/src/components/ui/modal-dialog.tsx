import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/icon";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

export type DialogSize = "sm" | "md" | "lg" | "xl";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function firstFocusable(root: Element | null): HTMLElement | null {
  if (!root) {
    return null;
  }

  for (const element of root.querySelectorAll<HTMLElement>(focusableSelector)) {
    if (!element.closest("[inert]")) {
      return element;
    }
  }

  return null;
}

export function ModalDialog({
  ariaLabel,
  children,
  className = "",
  closeOnBackdrop = false,
  description,
  footer,
  headerActions,
  onClose,
  returnFocusTo,
  size,
  title,
}: {
  /** Used when no `title` names the dialog; a titled dialog labels itself. */
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
  /** Optional subtitle under the title. */
  description?: ReactNode;
  /** Right-aligned action row; omitted dialogs render no footer. */
  footer?: ReactNode;
  /** Optional controls shown in the header before the close button. */
  headerActions?: ReactNode;
  onClose: () => void;
  /** Fallback focus target when the element that opened this dialog unmounted. */
  returnFocusTo?: RefObject<HTMLElement | null> | (() => HTMLElement | null);
  /** One of four standard widths; omit for a full-screen or custom frame. */
  size?: DialogSize;
  /** Rendering a title opts the dialog into the shared header/body/footer chrome. */
  title?: ReactNode;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeFromBackdrop = useEffectEvent(() => onClose());
  const resolveReturnFocus = useEffectEvent(() =>
    typeof returnFocusTo === "function"
      ? returnFocusTo()
      : (returnFocusTo?.current ?? null),
  );
  const headingId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const standard = title !== undefined;
  // Capture the opener before commit so a child `autoFocus` cannot overwrite it.
  const [initialOpener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null,
  );

  useLayoutEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const opener =
      initialOpener && !dialog.contains(initialOpener)
        ? initialOpener
        : document.activeElement instanceof HTMLElement &&
            document.activeElement !== document.body &&
            !dialog.contains(document.activeElement)
          ? document.activeElement
          : null;

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
        // showModal focuses the header close button first; keep initial focus on the content.
        if (document.activeElement === closeButtonRef.current) {
          (
            firstFocusable(dialog.querySelector(".app-dialog-body")) ??
            firstFocusable(dialog.querySelector(".app-dialog-footer"))
          )?.focus();
        }
      }
    } else {
      dialog.setAttribute("open", "");
    }

    return () => {
      const focusWasInside =
        document.activeElement === null ||
        document.activeElement === document.body ||
        dialog.contains(document.activeElement);
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      if (focusWasInside) {
        const target =
          opener && opener.isConnected
            ? opener
            : (() => {
                const fallback = resolveReturnFocus();
                return fallback && fallback.isConnected ? fallback : null;
              })();
        if (target) {
          // Defer past StrictMode's synchronous effect replay so only a real
          // unmount restores focus, without stomping explicit caller focus.
          queueMicrotask(() => {
            if (dialog.isConnected) return;
            const active = document.activeElement;
            if (
              active !== null &&
              active !== document.body &&
              active !== document.documentElement
            ) {
              return;
            }
            if (target.isConnected) target.focus();
          });
        }
      }
    };
  }, [initialOpener]);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog || !closeOnBackdrop) {
      return;
    }

    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target === dialog) closeFromBackdrop();
    };
    dialog.addEventListener("click", handleBackdropClick);
    return () => dialog.removeEventListener("click", handleBackdropClick);
  }, [closeOnBackdrop]);

  return createPortal(
    <dialog
      aria-label={standard ? undefined : ariaLabel}
      aria-labelledby={standard ? headingId : undefined}
      className={`app-dialog ${standard ? "app-dialog-standard" : ""} ${className}`}
      data-size={size}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      {standard ? (
        <>
          <header className="app-dialog-header">
            <div className="min-w-0 flex-1">
              <h2 className="app-dialog-title" id={headingId}>
                {title}
              </h2>
              {description !== undefined ? (
                <p className="app-dialog-description">{description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <button
                data-voice-close
                aria-label={t(commonMessages.close)}
                className="app-dialog-close"
                ref={closeButtonRef}
                onClick={onClose}
                type="button"
              >
                <Icon icon={Cancel01Icon} size={16} />
              </button>
            </div>
          </header>
          <div className="app-dialog-body">{children}</div>
          {footer !== undefined ? (
            <footer className="app-dialog-footer">{footer}</footer>
          ) : null}
        </>
      ) : (
        children
      )}
    </dialog>,
    document.body,
  );
}
