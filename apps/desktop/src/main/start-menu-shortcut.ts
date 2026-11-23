import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export interface ShortcutDetails {
  readonly target?: string;
  readonly appUserModelId?: string;
}

export interface StartMenuShortcutDependencies {
  readonly appData: string;
  readonly execPath: string;
  readonly appUserModelId: string;
  readonly env: NodeJS.ProcessEnv;
  readonly exists?: (file: string) => boolean;
  readonly realpath?: (file: string) => string;
  readonly readShortcutLink: (shortcutPath: string) => ShortcutDetails;
  readonly writeShortcutLink: (
    shortcutPath: string,
    operation: "update",
    options: { readonly target: string; readonly appUserModelId: string },
  ) => boolean;
  readonly onWriteError?: (error: unknown) => void;
}

function stripExtendedLengthPrefix(filePath: string): string {
  if (filePath.startsWith("\\\\?\\UNC\\")) return `\\\\${filePath.slice(8)}`;
  if (filePath.startsWith("\\\\?\\")) return filePath.slice(4);
  return filePath;
}

function normalizeWindowsPath(
  filePath: string | undefined,
  resolveRealpath: (file: string) => string,
): string | undefined {
  const trimmed = filePath?.trim();
  if (!trimmed || !path.win32.isAbsolute(trimmed)) return undefined;
  let canonical: string;
  try {
    canonical = resolveRealpath(trimmed);
  } catch {
    canonical = trimmed;
  }
  return path.win32.resolve(stripExtendedLengthPrefix(canonical)).toLowerCase();
}

/**
 * Stamps the Windows AppUserModelID onto the Start Menu shortcut only when
 * running the installation that the shortcut already targets. Skips isolated
 * user-data runs (LINGER_DESKTOP_USER_DATA) and portable/side-by-side binaries
 * so they never overwrite a user's installed Start Menu shortcut.
 */
export function markStartMenuShortcut(
  deps: StartMenuShortcutDependencies,
): boolean {
  if (deps.env.LINGER_DESKTOP_USER_DATA?.trim()) return false;
  const shortcut = path.win32.join(
    deps.appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Linger.lnk",
  );
  if (!(deps.exists ?? existsSync)(shortcut)) return false;
  let existing: ShortcutDetails;
  try {
    existing = deps.readShortcutLink(shortcut);
  } catch {
    return false;
  }
  const resolveRealpath = deps.realpath ?? realpathSync.native;
  const existingTarget = normalizeWindowsPath(existing.target, resolveRealpath);
  const currentExec = normalizeWindowsPath(deps.execPath, resolveRealpath);
  if (!existingTarget || !currentExec || existingTarget !== currentExec)
    return false;
  if (existing.appUserModelId === deps.appUserModelId) return false;
  try {
    return deps.writeShortcutLink(shortcut, "update", {
      target: existing.target!,
      appUserModelId: deps.appUserModelId,
    });
  } catch (error) {
    deps.onWriteError?.(error);
    return false;
  }
}
