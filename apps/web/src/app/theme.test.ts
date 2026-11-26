// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineGlobalProperty } from "@/test/global-properties";

import {
  cycleThemePreference,
  getResolvedTheme,
  getThemePreference,
  initTheme,
  resetThemeForTest,
  setThemePreference,
  subscribeToTheme,
  THEME_STORAGE_KEY,
  useTheme,
} from "./theme";

function mockColorScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  defineGlobalProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (typeof listener === "function") {
          listeners.add(listener);
        }
      },
      addListener: (listener) => {
        if (listener) listeners.add(listener);
      },
      dispatchEvent: () => false,
      get matches() {
        return query === "(prefers-color-scheme: dark)" ? dark : false;
      },
      media: query,
      onchange: null,
      removeEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (typeof listener === "function") {
          listeners.delete(listener);
        }
      },
      removeListener: (listener) => {
        if (listener) listeners.delete(listener);
      },
    }),
  });
  return {
    setDark(next: boolean) {
      dark = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function ThemeProbe() {
  const { preference, resolved } = useTheme();
  return createElement(
    "p",
    { "data-testid": "theme-probe" },
    `${preference}:${resolved}`,
  );
}

afterEach(() => {
  resetThemeForTest();
});

describe("theme", () => {
  it("defaults to system and resolves against prefers-color-scheme", () => {
    const scheme = mockColorScheme(true);
    initTheme();

    expect(getThemePreference()).toBe("system");
    expect(getResolvedTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    scheme.setDark(false);
    expect(getResolvedTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("persists explicit light and dark preferences and ignores OS changes when overridden", () => {
    const scheme = mockColorScheme(false);
    initTheme();

    setThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(getThemePreference()).toBe("dark");
    expect(getResolvedTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    scheme.setDark(false);
    expect(getResolvedTheme()).toBe("dark");

    setThemePreference("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getResolvedTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    scheme.setDark(true);
    expect(getResolvedTheme()).toBe("light");
  });

  it("cycles system -> dark -> light -> system directly and via linger:cycle-theme", () => {
    mockColorScheme(false);
    initTheme();

    expect(cycleThemePreference()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    window.dispatchEvent(new Event("linger:cycle-theme"));
    expect(getThemePreference()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    window.dispatchEvent(new Event("linger:cycle-theme"));
    expect(getThemePreference()).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to system for invalid stored values and reacts to cross-tab storage updates", () => {
    mockColorScheme(false);
    localStorage.setItem(THEME_STORAGE_KEY, "midnight");
    initTheme();
    expect(getThemePreference()).toBe("system");
    expect(getResolvedTheme()).toBe("light");

    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: "dark",
      }),
    );
    expect(getThemePreference()).toBe("dark");
    expect(getResolvedTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("notifies subscribers and updates useTheme consumers cleanly", () => {
    const scheme = mockColorScheme(false);
    initTheme();
    const listener = vi.fn();
    const unsubscribe = subscribeToTheme(listener);

    render(createElement(ThemeProbe));
    expect(screen.getByTestId("theme-probe")).toHaveTextContent("system:light");

    act(() => setThemePreference("dark"));
    expect(screen.getByTestId("theme-probe")).toHaveTextContent("dark:dark");
    expect(listener).toHaveBeenCalledTimes(1);

    act(() => setThemePreference("system"));
    act(() => scheme.setDark(true));
    expect(screen.getByTestId("theme-probe")).toHaveTextContent("system:dark");

    unsubscribe();
    act(() => setThemePreference("light"));
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
