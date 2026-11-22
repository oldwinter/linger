// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportLanguageToDesktop } from "./desktop-language";
import {
  LANGUAGE_STORAGE_KEY,
  resetLanguageForTest,
  restoreLanguage,
  setLanguage,
} from "./language";

const desktop = (set = vi.fn(async () => {})) => {
  Object.assign(window, { lingerDesktop: { language: { set } } });
  return set;
};

afterEach(() => {
  delete (window as { lingerDesktop?: unknown }).lingerDesktop;
  localStorage.clear();
  resetLanguageForTest();
});

describe("reportLanguageToDesktop", () => {
  it("leaves the app on the system's language until a choice is made", async () => {
    const set = desktop();
    await restoreLanguage();
    const stop = reportLanguageToDesktop();
    expect(set).not.toHaveBeenCalled();

    await setLanguage("zh-CN");
    expect(set).toHaveBeenLastCalledWith("zh-CN");
    await setLanguage("en");
    expect(set).toHaveBeenLastCalledWith("en");
    stop();
  });

  it("reports the remembered choice when the page starts", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-CN");
    const set = desktop();
    await restoreLanguage();
    const stop = reportLanguageToDesktop();
    expect(set).toHaveBeenCalledExactlyOnceWith("zh-CN");
    stop();
  });

  it("keeps the page working when the app refuses or is absent", async () => {
    desktop(vi.fn(async () => Promise.reject(new Error("Not allowed"))));
    const stop = reportLanguageToDesktop();
    await expect(setLanguage("zh-CN")).resolves.toBeUndefined();
    stop();

    delete (window as { lingerDesktop?: unknown }).lingerDesktop;
    expect(() => reportLanguageToDesktop()()).not.toThrow();
  });
});
