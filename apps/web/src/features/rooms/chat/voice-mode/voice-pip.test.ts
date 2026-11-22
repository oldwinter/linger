// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import {
  closeVoicePip,
  onVoicePipClosedByHuman,
  openVoicePip,
  resetVoicePipForTest,
  returnedToOpener,
  returnVoicePipToPage,
  voicePipSupported,
} from "./voice-pip";

/** A stand-in for the browser's picture-in-picture window. */
function installFakeVoicePip() {
  const frame = window.document.createElement("iframe");
  window.document.body.append(frame);
  const document = frame.contentDocument!;
  const listeners: (() => void)[] = [];
  const pipWindow = {
    document,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "pagehide") listeners.push(listener);
    },
    // A closed window is gone; the next request opens a fresh one.
    close: vi.fn(() => listeners.splice(0).forEach((listener) => listener())),
  };
  const requestWindow = vi.fn(async () => pipWindow as unknown as Window);
  defineGlobalProperty(window, "documentPictureInPicture", {
    configurable: true,
    value: { requestWindow },
  });
  return { document, frame, pipWindow, requestWindow };
}

/** A stand-in for the desktop app's bridge and the window it lets the page open. */
function installFakeDesktopVoiceWindow() {
  const frame = window.document.createElement("iframe");
  window.document.body.append(frame);
  const document = frame.contentDocument!;
  const listeners: (() => void)[] = [];
  const voiceWindow = {
    document,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "pagehide") listeners.push(listener);
    },
    close: vi.fn(() => listeners.splice(0).forEach((listener) => listener())),
  };
  const open = vi.fn(
    (_url?: string, _target?: string, _features?: string) =>
      voiceWindow as unknown as Window,
  );
  const showMain = vi.fn(async () => {});
  defineGlobalProperty(window, "open", { value: open });
  defineGlobalProperty(window, "lingerDesktop", {
    value: { voiceWindow: { showMainWindow: showMain } },
  });
  return { document, open, showMain, voiceWindow };
}

function removeFakeVoicePip() {
  document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  Reflect.deleteProperty(window, "documentPictureInPicture");
  resetVoicePipForTest();
}

afterEach(() => {
  removeFakeVoicePip();
  document.head.querySelectorAll("[data-test-style]").forEach((node) => {
    node.remove();
  });
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-desktop-shell");
  document.documentElement.removeAttribute("data-desktop-chrome");
});

describe("Voice Mode picture-in-picture window", () => {
  it("is unavailable where the browser lacks it", async () => {
    await expect(openVoicePip("voice-mode")).resolves.toBeUndefined();
  });

  it("stays in the page inside a desktop app that offers no voice window", async () => {
    const fake = installFakeVoicePip();
    const open = vi.fn();
    defineGlobalProperty(window, "open", { value: open });
    const desktop = window as { lingerDesktop?: unknown };
    for (const bridge of [{}, { voiceWindow: {} }]) {
      desktop.lingerDesktop = bridge;
      try {
        expect(voicePipSupported()).toBe(false);
        await expect(openVoicePip("voice-mode")).resolves.toBeUndefined();
        expect(fake.requestWindow).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
      } finally {
        delete desktop.lingerDesktop;
      }
    }
  });

  it("floats in the desktop app's own window where the app offers one", async () => {
    const browser = installFakeVoicePip();
    const fake = installFakeDesktopVoiceWindow();
    document.documentElement.setAttribute("data-desktop-shell", "");
    document.documentElement.setAttribute("data-desktop-chrome", "inset");
    expect(voicePipSupported()).toBe(true);

    await expect(openVoicePip("voice-mode")).resolves.toBe(fake.voiceWindow);
    expect(fake.open).toHaveBeenCalledOnce();
    expect(fake.open).toHaveBeenCalledWith(
      "",
      expect.stringMatching(/^linger-voice-window-\d+$/),
      "popup=yes,width=320,height=240",
    );
    expect(browser.requestWindow).not.toHaveBeenCalled();
    expect(fake.document.title).toBe("Voice Mode");
    // The window has a title bar of its own, so it leaves no room for the
    // main window's controls.
    const root = fake.document.documentElement;
    expect(root.hasAttribute("data-desktop-shell")).toBe(true);
    expect(root.hasAttribute("data-desktop-chrome")).toBe(false);

    await openVoicePip("recording");
    expect(fake.open).toHaveBeenLastCalledWith(
      "",
      expect.stringMatching(/^linger-voice-window-\d+$/),
      "popup=yes,width=420,height=720",
    );
    // A window still closing is never reused under the same name.
    expect(fake.open.mock.calls[0]?.[1]).not.toBe(fake.open.mock.calls[1]?.[1]);
    expect(fake.document.title).toBe("Meeting");
  });

  it("stays in the page when the desktop app refuses the window", async () => {
    const fake = installFakeDesktopVoiceWindow();
    fake.open.mockReturnValueOnce(null as unknown as Window);
    await expect(openVoicePip("voice-mode")).resolves.toBeUndefined();
  });

  it("returns from the desktop app's window only by its return button", async () => {
    const fake = installFakeDesktopVoiceWindow();
    const closedByHuman = vi.fn();
    const stop = onVoicePipClosedByHuman("voice-mode", closedByHuman);
    // No timing guess: the answer is there at once and no visibility change
    // of the page alters it.
    vi.useFakeTimers();
    try {
      await openVoicePip("voice-mode");
      returnVoicePipToPage("recording");
      expect(fake.voiceWindow.close).not.toHaveBeenCalled();
      returnVoicePipToPage("voice-mode");
      expect(fake.showMain).toHaveBeenCalledOnce();
      expect(fake.voiceWindow.close).toHaveBeenCalledOnce();
      expect(closedByHuman).toHaveBeenCalledOnce();
      await expect(returnedToOpener()).resolves.toBe(true);

      // The window's close button, with the main window coming to the front
      // at that moment, is still a close.
      await openVoicePip("voice-mode");
      fake.voiceWindow.close();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(closedByHuman).toHaveBeenCalledTimes(2);
      await expect(returnedToOpener()).resolves.toBe(false);
      expect(fake.showMain).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      stop();
    }
  });

  it("returns from the browser's window by the return button, bringing its tab to the front", async () => {
    const fake = installFakeVoicePip();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const closedByHuman = vi.fn();
    const stop = onVoicePipClosedByHuman("recording", closedByHuman);
    try {
      await openVoicePip("recording");
      returnVoicePipToPage("voice-mode");
      expect(focus).not.toHaveBeenCalled();
      returnVoicePipToPage("recording");
      expect(focus).toHaveBeenCalledOnce();
      expect(fake.pipWindow.close).toHaveBeenCalledOnce();
      expect(closedByHuman).toHaveBeenCalledOnce();
      // The button says it returned; nothing waits on the page's visibility.
      vi.useFakeTimers();
      await expect(returnedToOpener()).resolves.toBe(true);
      vi.useRealTimers();

      // The browser's own close button is still judged by whether the page
      // came to the front.
      await openVoicePip("recording");
      fake.pipWindow.close();
      await expect(returnedToOpener(20)).resolves.toBe(false);
      expect(focus).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      focus.mockRestore();
      stop();
    }
  });

  it("returns the call to the page even if the main window cannot be shown", async () => {
    const fake = installFakeDesktopVoiceWindow();
    fake.showMain.mockRejectedValueOnce(new Error("no window"));
    await openVoicePip("voice-mode");
    returnVoicePipToPage("voice-mode");
    expect(fake.voiceWindow.close).toHaveBeenCalledOnce();
    await expect(returnedToOpener()).resolves.toBe(true);
  });

  it("carries the page's styles and theme, including later ones", async () => {
    const early = document.createElement("style");
    early.dataset.testStyle = "";
    early.textContent = ".early {}";
    document.head.append(early);
    document.documentElement.setAttribute("data-theme", "dark");
    const fake = installFakeVoicePip();

    await openVoicePip("voice-mode");
    expect(fake.document.documentElement.dataset.theme).toBe("dark");
    expect(fake.document.head.textContent).toContain(".early {}");

    const late = document.createElement("style");
    late.dataset.testStyle = "";
    late.textContent = ".late {}";
    document.head.append(late);
    await vi.waitFor(() =>
      expect(fake.document.head.textContent).toContain(".late {}"),
    );
  });

  it("opens one window and tells a desktop close apart from the page closing it", async () => {
    const fake = installFakeVoicePip();
    const first = await openVoicePip("voice-mode");
    await expect(openVoicePip("voice-mode")).resolves.toBe(first);
    expect(fake.requestWindow).toHaveBeenCalledOnce();
    const closedByHuman = vi.fn();
    const stop = onVoicePipClosedByHuman("voice-mode", closedByHuman);
    closeVoicePip("voice-mode");
    expect(fake.pipWindow.close).toHaveBeenCalledOnce();
    expect(closedByHuman).not.toHaveBeenCalled();

    await openVoicePip("voice-mode");
    fake.pipWindow.close();
    expect(closedByHuman).toHaveBeenCalledOnce();
    stop();
  });

  it("reads back to tab only from the page coming to the front", async () => {
    installFakeVoicePip();
    await openVoicePip("voice-mode");
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    try {
      // Back to tab from a background tab brings the page to the front.
      const returned = returnedToOpener(20);
      document.dispatchEvent(new Event("visibilitychange"));
      await expect(returned).resolves.toBe(true);
      resetVoicePipForTest();
      // The documented trade-off: a page that stayed visible, focused
      // afterwards or not, reads as a close, so the close button always ends
      // the call even where back to tab on an unfocused visible window does too.
      await expect(returnedToOpener(20)).resolves.toBe(false);
    } finally {
      focused.mockRestore();
    }
  });

  it("gives the window to one owner at a time", async () => {
    const fake = installFakeVoicePip();
    const voiceModeClosed = vi.fn();
    const stop = onVoicePipClosedByHuman("voice-mode", voiceModeClosed);
    await openVoicePip("voice-mode");
    // Recording takes the tab's one window; Voice Mode's closes, not by the Human.
    await openVoicePip("recording");
    expect(fake.pipWindow.close).toHaveBeenCalledOnce();
    expect(voiceModeClosed).not.toHaveBeenCalled();
    // Closing someone else's window does nothing.
    closeVoicePip("voice-mode");
    expect(fake.pipWindow.close).toHaveBeenCalledOnce();
    stop();
  });
});
