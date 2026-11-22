import { focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, vi } from "vitest";

import { resetComposerAttachmentDraftsForTest } from "@/features/rooms/chat/composer-attachment-drafts";
import { resetLanguageForTest } from "@/i18n/language";
import { setRoomDiagnosticsEnabledForTest } from "@/lib/room-diagnostics";
import { restoreGlobalProperties } from "@/test/global-properties";
import { assertNoUnhandledTestRoutes } from "@/test/teamhub-test-server";

// Marks a global this setup wrapped, so a file loading it again in a shared
// environment does not wrap the wrapper.
const SETUP_WRAPPED = Symbol.for("linger.test.setupWrapped");

// Tests assert the Room timing diagnostics, which are off by default in browsers.
setRoomDiagnosticsEnabledForTest(true);

// Pure logic tests opt into Node and do not need the React/DOM harness.
let cleanupRenderedComponents: (() => void) | undefined;
let resetRoomTimelineReadingPositions: (() => void) | undefined;
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  // motion-utils owns the global config motion/react reads; loading all of
  // motion/react here cost every DOM test file ~0.1 s though few render it.
  const { MotionGlobalConfig } = await import("motion-utils");
  const { cleanup, configure } = await import("@testing-library/react");
  // Testing Library findBy/waitFor and vi.waitFor share the 5s budget. They resolve
  // as soon as the condition holds, so this only bounds how long a genuinely
  // failing wait takes; first-use lazy chunk transforms can exceed 1s on a loaded machine.
  configure({ asyncUtilTimeout: 5_000 });
  MotionGlobalConfig.skipAnimations = true;
  cleanupRenderedComponents = cleanup;
  // Reading positions are kept per Room in a module map; a test must not open
  // a Room scrolled where an earlier test left it.
  ({
    resetRoomTimelineReadingPositionsForTest: resetRoomTimelineReadingPositions,
  } = await import("@/features/rooms/chat/use-room-timeline-scroll"));

  // jsdom has no layout observer. Geometry tests supply measured entries;
  // other component tests only need the browser API's lifecycle.
  if (typeof ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // Browsers stamp animation frames with the performance.now() clock. jsdom uses
  // its own clock, which starts when the window is created, while performance is
  // Node's, which starts with the process. Under the threads pool that is the
  // shared Vitest process, so frame-driven animations ran for minutes and kept
  // re-rendering until they starved pending Suspense retries.
  // Files sharing a window load this setup again; wrap the frame function once.
  if (!(SETUP_WRAPPED in window.requestAnimationFrame)) {
    const stampAnimationFrame = window.requestAnimationFrame.bind(window);
    globalThis.requestAnimationFrame = Object.assign(
      (callback: FrameRequestCallback) =>
        stampAnimationFrame(() => callback(performance.now())),
      { [SETUP_WRAPPED]: true },
    );
  }

  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string): MediaQueryList => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
    });
  }

  if (
    typeof HTMLElement !== "undefined" &&
    !HTMLElement.prototype.scrollIntoView
  ) {
    HTMLElement.prototype.scrollIntoView = () => undefined;
  }
}

// vi.waitFor defaults to a 1s wall-clock budget; align it with the Testing Library
// wait. vi is shared by files sharing a worker, so it is wrapped once.
if (!(SETUP_WRAPPED in vi.waitFor)) {
  const waitForWithDefault = vi.waitFor;
  vi.waitFor = Object.assign(
    ((callback, options) =>
      waitForWithDefault(
        callback,
        typeof options === "number" ? options : { timeout: 5_000, ...options },
      )) as typeof vi.waitFor,
    { [SETUP_WRAPPED]: true },
  );
}

// Files without module mocks share one window per worker (see
// vitest.config.ts), so each test returns the globals it may touch to the state
// the next file expects from a fresh environment.
const initialHeadNodes =
  typeof document === "undefined" ? [] : [...document.head.childNodes];
const initialUrl = typeof window === "undefined" ? "" : window.location.href;

function resetDocumentGlobals() {
  if (typeof document === "undefined") return;
  // A test may stub storage with a plain object; vi.stubGlobal restores the
  // real one afterwards, which that test never wrote to.
  for (const storage of [localStorage, sessionStorage]) {
    if (storage instanceof Storage) storage.clear();
  }
  document.body.replaceChildren();
  for (const attribute of [...document.body.attributes]) {
    document.body.removeAttribute(attribute.name);
  }
  for (const node of [...document.head.childNodes]) {
    if (!initialHeadNodes.includes(node)) node.remove();
  }
  for (const attribute of [...document.documentElement.attributes]) {
    document.documentElement.removeAttribute(attribute.name);
  }
  document.title = "";
  if (window.location.href !== initialUrl) {
    window.history.replaceState(null, "", initialUrl);
  }
}

// The worker's real timer functions, captured by the first file to load this
// setup: a later file may already run with a leaked replacement.
type TimerGlobal =
  | "setTimeout"
  | "clearTimeout"
  | "setInterval"
  | "clearInterval"
  | "Date";
const TIMER_GLOBALS: TimerGlobal[] = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "Date",
];
const realTimers = ((
  globalThis as { __lingerRealTimers?: Record<TimerGlobal, unknown> }
).__lingerRealTimers ??= Object.fromEntries(
  TIMER_GLOBALS.map((name) => [name, globalThis[name]]),
) as Record<TimerGlobal, unknown>);

// A spy created on a timer while fake timers are on records the fake clock's
// function as the original; restoring it after useRealTimers writes that dead
// function back, and every later timer in the worker never fires (waitFor
// stops re-checking). Restore the real ones and fail the test that leaked.
function assertRealTimerGlobals() {
  vi.restoreAllMocks();
  const leaked = TIMER_GLOBALS.filter(
    (name) => globalThis[name] !== realTimers[name],
  );
  if (leaked.length === 0) return;
  for (const name of leaked) {
    Object.assign(globalThis, { [name]: realTimers[name] });
  }
  throw new Error(
    `This test left fake ${leaked.join(", ")} on the global object. ` +
      "Restore timer spies before vi.useRealTimers(), or spy on timers before vi.useFakeTimers().",
  );
}

afterEach(() => {
  try {
    cleanupRenderedComponents?.();
    // Shared modules such as Motion's frame loop keep a "frame requested" flag
    // until their callback runs; dropping a fake frame or timer would stall
    // them for every later file in this worker, so pending ones run first.
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    restoreGlobalProperties();
    // TanStack Query keeps focus and network state in module singletons that a
    // test drives through browser events; a stale "offline" or "unfocused"
    // would pause every later file's queries in this worker.
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    resetDocumentGlobals();
    resetComposerAttachmentDraftsForTest();
    // The language on screen is module state the files of a worker share.
    resetLanguageForTest();
    resetRoomTimelineReadingPositions?.();
    // Timers first: a later assertion that throws must not leave a leaked fake
    // timer on the window the next file shares.
    assertRealTimerGlobals();
    assertNoUnhandledTestRoutes();
  }
});
