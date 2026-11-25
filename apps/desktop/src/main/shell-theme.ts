import { nativeTheme } from "electron";

export interface ShellColors {
  readonly canvas: string;
  readonly content: string;
  readonly titleBarSymbol: string;
}

export const LIGHT_SHELL_COLORS: ShellColors = {
  canvas: "#f6f6f6",
  content: "#ffffff",
  titleBarSymbol: "#404040",
};

export const DARK_SHELL_COLORS: ShellColors = {
  canvas: "#161614",
  content: "#161614",
  titleBarSymbol: "#e8e7e2",
};

export function shellColors(dark: boolean): ShellColors {
  return dark ? DARK_SHELL_COLORS : LIGHT_SHELL_COLORS;
}

export function currentShellColors(): ShellColors {
  return shellColors(nativeTheme?.shouldUseDarkColors ?? false);
}

export function onShellThemeChange(
  listener: (colors: ShellColors) => void,
): () => void {
  if (!nativeTheme || typeof nativeTheme.on !== "function") return () => {};
  const handle = (): void => listener(currentShellColors());
  nativeTheme.on("updated", handle);
  return () => {
    if (typeof nativeTheme.off === "function") {
      nativeTheme.off("updated", handle);
    } else if (typeof nativeTheme.removeListener === "function") {
      nativeTheme.removeListener("updated", handle);
    }
  };
}
