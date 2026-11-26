import { useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "linger.theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface ThemeState {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
}

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const CYCLE_THEME_EVENT = "linger:cycle-theme";

const NEXT_THEME_PREFERENCE: Readonly<
  Record<ThemePreference, ThemePreference>
> = {
  system: "dark",
  dark: "light",
  light: "system",
};

const listeners = new Set<() => void>();
let currentState: ThemeState = readEnvironmentState();
let cleanupRuntimeListeners: (() => void) | undefined;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function readSystemTheme(): ResolvedTheme {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? readSystemTheme() : preference;
}

function readEnvironmentState(): ThemeState {
  const preference = readStoredPreference();
  return { preference, resolved: resolveTheme(preference) };
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

function commitState(next: ThemeState): void {
  const changed =
    next.preference !== currentState.preference ||
    next.resolved !== currentState.resolved;
  if (changed) {
    currentState = next;
  }
  applyResolvedTheme(currentState.resolved);
  if (changed) {
    for (const listener of listeners) listener();
  }
}

function getThemeSnapshot(): ThemeState {
  return currentState;
}

export function getThemePreference(): ThemePreference {
  return currentState.preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return currentState.resolved;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Keep the chosen theme for this session when browser storage is unavailable.
  }
  commitState({ preference, resolved: resolveTheme(preference) });
}

export function cycleThemePreference(): ThemePreference {
  const next = NEXT_THEME_PREFERENCE[currentState.preference];
  setThemePreference(next);
  return next;
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function initTheme(): void {
  commitState(readEnvironmentState());

  if (typeof window === "undefined" || cleanupRuntimeListeners) return;

  const mediaQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia(DARK_MEDIA_QUERY)
      : undefined;

  const handleMediaChange = (event: MediaQueryListEvent): void => {
    if (currentState.preference !== "system") return;
    commitState({
      preference: "system",
      resolved: event.matches ? "dark" : "light",
    });
  };

  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    commitState(readEnvironmentState());
  };

  const handleCycleEvent = (): void => {
    cycleThemePreference();
  };

  if (mediaQuery) {
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleMediaChange);
    }
  }
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CYCLE_THEME_EVENT, handleCycleEvent);

  cleanupRuntimeListeners = () => {
    if (mediaQuery) {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", handleMediaChange);
      } else if (typeof mediaQuery.removeListener === "function") {
        mediaQuery.removeListener(handleMediaChange);
      }
    }
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CYCLE_THEME_EVENT, handleCycleEvent);
  };
}

export function useTheme() {
  const state = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeSnapshot,
  );
  return {
    preference: state.preference,
    resolved: state.resolved,
    setPreference: setThemePreference,
    cycle: cycleThemePreference,
  };
}

/** Resets theme listeners and module state between unit tests. */
export function resetThemeForTest(): void {
  cleanupRuntimeListeners?.();
  cleanupRuntimeListeners = undefined;
  currentState = { preference: "system", resolved: readSystemTheme() };
  for (const listener of listeners) listener();
}
