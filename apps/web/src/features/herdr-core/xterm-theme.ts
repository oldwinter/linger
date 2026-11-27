import type { ITheme } from "@xterm/xterm";

export type XtermResolvedTheme = "light" | "dark";

const TOWN_LIGHT_XTERM_THEME: ITheme = {
  background: "#fcfcfa",
  foreground: "#1a1916",
  cursor: "#1a1916",
  cursorAccent: "#fcfcfa",
  selectionBackground: "#d8e6f8",
  selectionForeground: "#1a1916",
  selectionInactiveBackground: "#e8e7e0",
  black: "#1a1916",
  red: "#c23b18",
  green: "#2f6e33",
  yellow: "#946200",
  blue: "#0b67b2",
  magenta: "#7e4696",
  cyan: "#1e6e75",
  white: "#6f6e66",
  brightBlack: "#5c5b53",
  brightRed: "#d94f26",
  brightGreen: "#3f8744",
  brightYellow: "#ad7300",
  brightBlue: "#1d7cc9",
  brightMagenta: "#965eb0",
  brightCyan: "#2b868e",
  brightWhite: "#8e8d83",
};

const TOWN_DARK_XTERM_THEME: ITheme = {
  background: "#1b1b18",
  foreground: "#e8e7e2",
  cursor: "#e8e7e2",
  cursorAccent: "#1b1b18",
  selectionBackground: "#344a63",
  selectionForeground: "#f5f4ef",
  selectionInactiveBackground: "#2c2c27",
  black: "#2a2a25",
  red: "#ee7556",
  green: "#7bc66c",
  yellow: "#ebb64d",
  blue: "#6cb4f2",
  magenta: "#c69ee0",
  cyan: "#6ac2ca",
  white: "#cfcec6",
  brightBlack: "#7a796f",
  brightRed: "#f69177",
  brightGreen: "#98d88a",
  brightYellow: "#f5ca6e",
  brightBlue: "#90c8f8",
  brightMagenta: "#d9b8ef",
  brightCyan: "#8bd7de",
  brightWhite: "#f2f1ec",
};

export function detectDocumentTheme(): XtermResolvedTheme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme;
    if (attr === "dark") return "dark";
    if (attr === "light") return "light";
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Builds a complete 16-color Town Light or Town Dark theme for `@xterm/xterm`
 * so ANSI output remains crisp and WCAG-readable in both themes.
 */
export function resolveXtermTheme(mode?: XtermResolvedTheme): ITheme {
  const resolved = mode ?? detectDocumentTheme();
  const base =
    resolved === "dark" ? TOWN_DARK_XTERM_THEME : TOWN_LIGHT_XTERM_THEME;
  return { ...base };
}

export const XTERM_FONT_FAMILY =
  '"JetBrains Mono", "SF Mono", Menlo, ui-monospace, SFMono-Regular, Consolas, monospace';
