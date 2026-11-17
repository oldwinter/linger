import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useSyncExternalStore,
} from "react";

import { Icon } from "@/components/ui/icon";

const mobileQueries = {
  sm: "(width < 40rem)",
  md: "(width < 48rem)",
};

export function NavigationDrawer({
  ariaLabel,
  children,
  closeLabel,
  mobileBreakpoint = "md",
  onClose,
  open,
}: {
  ariaLabel: string;
  children: ReactNode;
  closeLabel: string;
  mobileBreakpoint?: "sm" | "md";
  onClose: () => void;
  open: boolean;
}) {
  const mobileQuery = mobileQueries[mobileBreakpoint];
  const subscribeToMobileViewport = useCallback(
    (onChange: () => void) => {
      const viewport = window.matchMedia(mobileQuery);
      viewport.addEventListener("change", onChange);
      return () => viewport.removeEventListener("change", onChange);
    },
    [mobileQuery],
  );
  const isMobileViewport = useCallback(
    () => window.matchMedia(mobileQuery).matches,
    [mobileQuery],
  );
  const mobile = useSyncExternalStore(
    subscribeToMobileViewport,
    isMobileViewport,
    () => false,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modalOpenRef = useRef(false);
  const closeMobile = useEffectEvent(onClose);
  const closeFromBackdrop = useEffectEvent(() => {
    if (mobile) onClose();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (mobile && open) {
      if (modalOpenRef.current) return;
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      modalOpenRef.current = true;
      return;
    }

    const focusedControl =
      modalOpenRef.current && dialog.contains(document.activeElement)
        ? document.activeElement
        : null;
    if (modalOpenRef.current && typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    modalOpenRef.current = false;

    if (!mobile) {
      // Resizing must not restore focus to the now-hidden mobile opener.
      if (focusedControl instanceof HTMLElement) focusedControl.focus();
      if (open) closeMobile();
    }
  }, [mobile, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target === dialog) closeFromBackdrop();
    };
    dialog?.addEventListener("click", handleBackdropClick);
    return () => {
      dialog?.removeEventListener("click", handleBackdropClick);
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      modalOpenRef.current = false;
    };
  }, []);

  return (
    <dialog
      aria-label={mobile ? ariaLabel : undefined}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-inherit backdrop:bg-(--app-overlay) backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        if (event.target !== event.currentTarget || !mobile) return;
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
      role={mobile ? undefined : "presentation"}
      style={{ display: mobile ? undefined : "contents" }}
    >
      {children}
      {mobile && open ? (
        <button
          aria-label={closeLabel}
          className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-full bg-card text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
          type="button"
        >
          <Icon icon={Cancel01Icon} size={20} />
        </button>
      ) : null}
    </dialog>
  );
}
