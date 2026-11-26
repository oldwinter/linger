export type ToastTone = "neutral" | "success" | "danger";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ShowToastOptions {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly durationMs?: number;
  readonly action?: ToastAction;
}

export interface ToastRecord {
  readonly id: string;
  readonly message: string;
  readonly tone: ToastTone;
  readonly durationMs: number;
  readonly action?: ToastAction;
}

interface ToastTimerEntry {
  remainingMs: number;
  startedAt: number | null;
  timer?: ReturnType<typeof setTimeout>;
}

export const DEFAULT_TOAST_DURATION_MS = 4_000;
export const MAX_VISIBLE_TOASTS = 3;

let nextToastId = 0;
let toasts: readonly ToastRecord[] = [];
const timers = new Map<string, ToastTimerEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function clearTimer(id: string): void {
  const entry = timers.get(id);
  if (entry?.timer !== undefined) {
    clearTimeout(entry.timer);
  }
  timers.delete(id);
}

function scheduleTimer(id: string, durationMs: number): void {
  if (durationMs <= 0) return;
  const entry: ToastTimerEntry = {
    remainingMs: durationMs,
    startedAt: Date.now(),
  };
  entry.timer = setTimeout(() => {
    dismissToast(id);
  }, durationMs);
  timers.set(id, entry);
}

export function showToast(options: ShowToastOptions): string {
  const id = `toast-${++nextToastId}`;
  const durationMs = options.durationMs ?? DEFAULT_TOAST_DURATION_MS;
  const record: ToastRecord = {
    id,
    message: options.message,
    tone: options.tone ?? "neutral",
    durationMs,
    ...(options.action ? { action: options.action } : {}),
  };

  let next = [...toasts, record];
  if (next.length > MAX_VISIBLE_TOASTS) {
    const overflow = next.slice(0, next.length - MAX_VISIBLE_TOASTS);
    for (const removed of overflow) clearTimer(removed.id);
    next = next.slice(-MAX_VISIBLE_TOASTS);
  }

  toasts = next;
  scheduleTimer(id, durationMs);
  notify();
  return id;
}

export function dismissToast(id: string): void {
  clearTimer(id);
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  notify();
}

export function clearToasts(): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  if (toasts.length === 0) return;
  toasts = [];
  notify();
}

export function pauseToastTimer(id: string): void {
  const entry = timers.get(id);
  if (!entry || entry.timer === undefined || entry.startedAt === null) return;
  clearTimeout(entry.timer);
  entry.timer = undefined;
  entry.remainingMs = Math.max(
    0,
    entry.remainingMs - (Date.now() - entry.startedAt),
  );
  entry.startedAt = null;
}

export function resumeToastTimer(id: string): void {
  const entry = timers.get(id);
  if (!entry || entry.timer !== undefined) return;
  if (entry.remainingMs <= 0) {
    dismissToast(id);
    return;
  }
  entry.startedAt = Date.now();
  entry.timer = setTimeout(() => {
    dismissToast(id);
  }, entry.remainingMs);
}

export function getToastsSnapshot(): readonly ToastRecord[] {
  return toasts;
}

export function subscribeToToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
