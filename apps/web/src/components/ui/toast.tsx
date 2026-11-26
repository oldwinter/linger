import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore } from "react";

import { Icon } from "@/components/ui/icon";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import {
  dismissToast,
  getToastsSnapshot,
  pauseToastTimer,
  resumeToastTimer,
  subscribeToToasts,
  type ToastRecord,
} from "./toast-store";
import { uiExtrasMessages } from "./ui-extras.messages";

export { clearToasts, dismissToast, showToast } from "./toast-store";
export type {
  ShowToastOptions,
  ToastAction,
  ToastRecord,
  ToastTone,
} from "./toast-store";

export function ToastViewport() {
  const t = useT();
  const toasts = useSyncExternalStore(
    subscribeToToasts,
    getToastsSnapshot,
    getToastsSnapshot,
  );

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label={t(uiExtrasMessages.notifications)}
      className="pointer-events-none fixed right-4 bottom-4 z-[200] flex w-full max-w-sm flex-col items-end gap-2 max-sm:right-3 max-sm:left-3 max-sm:w-auto max-sm:max-w-none"
      role="region"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastRecord }) {
  const t = useT();
  const isDanger = toast.tone === "danger";

  return (
    <div
      aria-atomic="true"
      aria-live={isDanger ? "assertive" : "polite"}
      className={cn(
        "toast-item-enter pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl border bg-popover px-3.5 py-2.5 text-sm text-foreground shadow-lg",
        isDanger ? "border-(--app-status-danger-border)" : "border-border",
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          resumeToastTimer(toast.id);
        }
      }}
      onFocus={() => pauseToastTimer(toast.id)}
      onMouseEnter={() => pauseToastTimer(toast.id)}
      onMouseLeave={() => resumeToastTimer(toast.id)}
      role={isDanger ? "alert" : "status"}
    >
      {toast.tone !== "neutral" ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            isDanger ? "bg-destructive" : "bg-app-success",
          )}
        />
      ) : null}
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action ? (
        <button
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-foreground underline-offset-2 transition-colors hover:bg-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          onClick={() => {
            toast.action?.onClick();
            dismissToast(toast.id);
          }}
          type="button"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        aria-label={t(commonMessages.close)}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        data-voice-close=""
        onClick={() => dismissToast(toast.id)}
        type="button"
      >
        <Icon icon={Cancel01Icon} size={14} />
      </button>
    </div>
  );
}
