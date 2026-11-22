import { getLanguage, storedLanguage, subscribeToLanguage } from "./language";

// The desktop app's side of the language choice
// (`window.lingerDesktop.language`); absent in a browser and in desktop
// builds whose own menus and windows are English only.
interface DesktopLanguage {
  set(language: string): Promise<void>;
}

function desktopLanguage(): DesktopLanguage | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as { lingerDesktop?: { language?: DesktopLanguage } })
        .lingerDesktop?.language;
}

/**
 * Tells the desktop app the language the person chose, now and on every
 * switch, so its menus, tray, notifications and own windows follow it.
 * Without a remembered choice nothing is reported, and the app keeps
 * following the system's language. Call after `restoreLanguage`.
 */
export function reportLanguageToDesktop(): () => void {
  const api = desktopLanguage();
  if (!api) return () => {};
  const report = () => {
    // An app that cannot take it keeps its current language.
    api.set(getLanguage()).catch(() => {});
  };
  if (storedLanguage()) report();
  // Each switch on screen is a choice: Settings › Language here or in
  // another tab.
  return subscribeToLanguage(report);
}
