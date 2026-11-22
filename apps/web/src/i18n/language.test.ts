// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { settingsMessages } from "@/features/settings/settings.messages";

import {
  LANGUAGE_STORAGE_KEY,
  formatLocale,
  getLanguage,
  getTranslation,
  restoreLanguage,
  setLanguage,
  subscribeToLanguage,
  translate,
} from "./language";
import zhCN from "./locales/zh-CN.json";

describe("interface language", () => {
  it("starts in English with nothing stored", async () => {
    await restoreLanguage();
    expect(getLanguage()).toBe("en");
    expect(translate(settingsMessages.title)).toBe("Settings");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("switches at once, remembers the choice and marks the document", async () => {
    const changed = vi.fn();
    const unsubscribe = subscribeToLanguage(changed);
    const english = getTranslation();
    await setLanguage("zh-CN");
    unsubscribe();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(getTranslation()).not.toBe(english);
    expect(getLanguage()).toBe("zh-CN");
    expect(translate(settingsMessages.title)).toBe(zhCN.settings.title);
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");

    await setLanguage("en");
    expect(translate(settingsMessages.title)).toBe("Settings");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("restores the remembered language before the app renders", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-CN");
    await restoreLanguage();
    expect(getLanguage()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("ignores a stored value it does not know and leaves it in place", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "system");
    await restoreLanguage();
    expect(getLanguage()).toBe("en");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("system");
  });

  it("follows a choice made in another tab", async () => {
    await restoreLanguage();
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-CN");
    window.dispatchEvent(
      new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }),
    );
    await vi.waitFor(() => expect(getLanguage()).toBe("zh-CN"));
  });

  it("keeps the newest choice when two switches overlap", async () => {
    const first = setLanguage("zh-CN");
    const second = setLanguage("en");
    await Promise.all([first, second]);
    expect(getLanguage()).toBe("en");
  });

  it("keeps another tab's newer choice over a switch still loading", async () => {
    await restoreLanguage();
    const mine = setLanguage("zh-CN");
    // Another tab chooses English while the Chinese catalog is loading.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    window.dispatchEvent(
      new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }),
    );
    await mine;
    await vi.waitFor(() => expect(getLanguage()).toBe("en"));
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("still switches when the choice cannot be saved", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await setLanguage("zh-CN");
    expect(getLanguage()).toBe("zh-CN");
    expect(localStorage).toHaveLength(0);
  });

  it("names the Intl locale of the language on screen", async () => {
    expect(formatLocale()).toBe("en-US");
    await setLanguage("zh-CN");
    expect(formatLocale()).toBe("zh-CN");
    expect(formatLocale("en")).toBe("en-US");
  });
});
