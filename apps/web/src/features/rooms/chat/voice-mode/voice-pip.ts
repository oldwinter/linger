import { useSyncExternalStore } from "react";

import { isDesktopShell } from "@/app/desktop-shell";
import { translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";
import { voiceWindowMessages } from "./voice-window.messages";

/** Chrome and Edge 116+ only; TypeScript's DOM library does not declare it yet. */
interface DocumentPictureInPicture {
  requestWindow(options?: {
    height?: number;
    width?: number;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
}

/**
 * The desktop app's floating window (`window.lingerDesktop.voiceWindow`): the
 * page opens a blank window under `desktopWindowTarget` and the app keeps it
 * on top, also while its main window is minimized or closed to the tray.
 */
interface DesktopVoiceWindow {
  showMainWindow(): Promise<void>;
}

/**
 * The window name the desktop app recognizes; it floats the window opened
 * under it. The suffix keeps a window that is still closing from being reused.
 */
const desktopWindowTarget = "linger-voice-window";
let desktopWindowCount = 0;

interface PipSize {
  height: number;
  width: number;
}

/** Voice Mode and Recording never run together; each asks for its own window. */
export type VoicePipOwner = "voice-mode" | "recording";

// About each page window's size when it opens; the Human drags it bigger and
// the browser remembers that size.
const pipSizes = {
  "voice-mode": { height: 240, width: 320 },
  recording: { height: 720, width: 420 },
} satisfies Record<VoicePipOwner, PipSize>;

// What the desktop shows as the window's name; browsers show the site instead.
const pipTitles = {
  "voice-mode": voiceWindowMessages.title,
  recording: voiceWindowMessages.meetingTitle,
} satisfies Record<VoicePipOwner, Message<string>>;

let pip: { owner: VoicePipOwner; window: Window } | undefined;
const listeners = new Set<() => void>();
const closedByHuman = new Set<(owner: VoicePipOwner) => void>();
/** When this page last came to the front from the background. */
let shownAt = Number.NEGATIVE_INFINITY;
let watchingVisibility = false;
/** Set while the voice window's return button closes the floating window. */
let returning = false;
/** How the floating window last closed, when that is known for sure. */
let returnedByButton: boolean | undefined;

function noteShown() {
  if (document.visibilityState === "visible") shownAt = performance.now();
}

function desktopVoiceWindow(): DesktopVoiceWindow | undefined {
  const voiceWindow = (
    window as Window & {
      lingerDesktop?: { voiceWindow?: Partial<DesktopVoiceWindow> };
    }
  ).lingerDesktop?.voiceWindow;
  return typeof voiceWindow?.showMainWindow === "function"
    ? (voiceWindow as DesktopVoiceWindow)
    : undefined;
}

/** How this client opens the floating window, if it can. */
function floatingWindowOpener():
  | ((
      size: PipSize & { preferInitialWindowPlacement: boolean },
    ) => Promise<Window | null>)
  | undefined {
  if (desktopVoiceWindow())
    return ({ height, width }) =>
      Promise.resolve(
        window.open(
          "",
          `${desktopWindowTarget}-${++desktopWindowCount}`,
          `popup=yes,width=${width},height=${height}`,
        ),
      );
  // A desktop app without that window exposes the browser API but cannot open
  // its window, so there voice windows stay in the page and offer no float
  // button.
  if (isDesktopShell()) return undefined;
  const pictureInPicture = (
    window as Window & { documentPictureInPicture?: DocumentPictureInPicture }
  ).documentPictureInPicture;
  return pictureInPicture
    ? (size) => pictureInPicture.requestWindow(size)
    : undefined;
}

/** Whether this client can float a voice window over other windows and apps. */
export function voicePipSupported() {
  return floatingWindowOpener() !== undefined;
}

function publish(next: typeof pip) {
  pip = next;
  for (const listener of listeners) listener();
}

/**
 * Opens the always-on-top window a voice window moves into, so it stays
 * visible over other tabs and apps and can be dragged anywhere on the desktop.
 * The browser allows this only inside a click, so call it synchronously from
 * the click handler. Resolves undefined when the client refuses.
 */
export async function openVoicePip(
  owner: VoicePipOwner,
  {
    preferInitialWindowPlacement = false,
  }: { preferInitialWindowPlacement?: boolean } = {},
): Promise<Window | undefined> {
  const open = floatingWindowOpener();
  if (!open) return undefined;
  // A page gets one such window; the newest owner takes it.
  if (pip?.owner === owner) return pip.window;
  if (pip) closeVoicePip(pip.owner);
  if (!watchingVisibility) {
    document.addEventListener("visibilitychange", noteShown);
    watchingVisibility = true;
  }
  // The desktop app's window has no back to tab button, so there every close
  // that is not the return button is a close.
  const closesOnly = desktopVoiceWindow() !== undefined;
  try {
    const opened = await open({
      ...pipSizes[owner],
      preferInitialWindowPlacement,
    });
    if (!opened) return undefined;
    returning = false;
    returnedByButton = undefined;
    opened.document.title = translate(pipTitles[owner]);
    const stopMirroring = mirrorStyles(opened.document);
    opened.addEventListener("pagehide", () => {
      stopMirroring();
      if (pip?.window !== opened) return;
      // Closed from the window itself rather than from the page.
      publish(undefined);
      if (returning || closesOnly) returnedByButton = returning;
      returning = false;
      for (const listener of closedByHuman) listener(owner);
    });
    publish({ owner, window: opened });
    return opened;
  } catch {
    return undefined;
  }
}

export function closeVoicePip(owner: VoicePipOwner) {
  if (pip?.owner !== owner) return;
  const current = pip.window;
  publish(undefined);
  current.close();
}

/**
 * The voice window's own return button: brings the desktop app's main window,
 * or this browser tab, to the front and closes the floating window, which its
 * owner then reads as a return through `returnedToOpener`. Call it from the
 * click; a browser lets a page come to the front only then.
 */
export function returnVoicePipToPage(owner: VoicePipOwner) {
  if (pip?.owner !== owner) return;
  returning = true;
  const desktop = desktopVoiceWindow();
  // The call still moves into the page if the main window cannot be shown.
  if (desktop) void desktop.showMainWindow().catch(() => undefined);
  else window.focus();
  pip.window.close();
}

/**
 * Whether closing the window brought the Human back to this page. The voice
 * window's own return button says so itself. A browser's window also has a
 * "back to tab" button, which closes it and brings its tab from the
 * background to the front; its close button does not. The browser reports
 * neither, so for those this checks a moment later whether the page came to
 * the front around the close. A close while this page was already in front is
 * a close, even though focus lands on the page afterwards.
 *
 * Trade-off: back to tab on a page that stayed visible but unfocused (its
 * window on another screen, or only partly covered, while the Human works in
 * another app) brings no visibility change and also reads as a close, so the
 * call ends. Telling it apart by focus instead made the close button keep the
 * call whenever the page was in front; a close that ends the call is the
 * surer of the two, and starting Voice Mode again floats a new window.
 *
 * The desktop app's window needs no such guess: it has no back to tab button,
 * so only the voice window's return button returns and every other close is a
 * close.
 */
export function returnedToOpener(waitMs = 300): Promise<boolean> {
  if (returnedByButton !== undefined) {
    const returned = returnedByButton;
    returnedByButton = undefined;
    return Promise.resolve(returned);
  }
  const closedAt = performance.now();
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve(
          document.visibilityState === "visible" &&
            shownAt >= closedAt - waitMs,
        ),
      waitMs,
    ),
  );
}

/** Runs when this owner's window closes from the window, not from the page. */
export function onVoicePipClosedByHuman(
  owner: VoicePipOwner,
  listener: () => void,
) {
  const forOwner = (closed: VoicePipOwner) => {
    if (closed === owner) listener();
  };
  closedByHuman.add(forOwner);
  return () => {
    closedByHuman.delete(forOwner);
  };
}

/** This owner's picture-in-picture window, if its voice window lives there. */
export function useVoicePip(owner: VoicePipOwner) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (pip?.owner === owner ? pip.window : undefined),
    () => undefined,
  );
}

/**
 * Copies the page's styles and theme into the new window, including styles a
 * lazily loaded chunk adds later, so the window looks the same in both places.
 */
function mirrorStyles(target: Document) {
  const root = document.documentElement;
  // The floating window has a title bar of its own, so it takes no room for
  // window controls the way the desktop app's main window does on macOS.
  for (const { name, value } of Array.from(root.attributes))
    if (name !== "data-desktop-chrome")
      target.documentElement.setAttribute(name, value);
  const copy = (node: Node) => {
    if (
      node instanceof HTMLStyleElement ||
      (node instanceof HTMLLinkElement && node.rel === "stylesheet")
    )
      target.head.append(node.cloneNode(true));
  };
  document.head.childNodes.forEach(copy);
  target.body.style.margin = "0";
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(copy);
  });
  observer.observe(document.head, { childList: true });
  return () => observer.disconnect();
}

export function resetVoicePipForTest() {
  pip = undefined;
  listeners.clear();
  closedByHuman.clear();
  shownAt = Number.NEGATIVE_INFINITY;
  returning = false;
  returnedByButton = undefined;
}
