import { defineMessages } from "@linger/service-kit/messages";
import { describe, expect, it } from "vitest";

import { trayMessages } from "../main/tray.messages.js";
import { matchLanguage, translator } from "./language.js";
import zhCN from "./locales/zh-CN.json" with { type: "json" };

describe("matchLanguage", () => {
  it("picks the first preferred language the shell speaks", () => {
    expect(matchLanguage(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(matchLanguage(["fr-FR", "zh-Hans-SG", "en"])).toBe("zh-CN");
    expect(matchLanguage(["en-GB", "zh-CN"])).toBe("en");
    expect(matchLanguage(["zh"])).toBe("zh-CN");
  });

  it("keeps Traditional Chinese and unknown languages in English", () => {
    expect(matchLanguage(["zh-TW"])).toBe("en");
    expect(matchLanguage(["zh-Hant-HK"])).toBe("en");
    expect(matchLanguage(["fr", "de"])).toBe("en");
    expect(matchLanguage(["not a tag"])).toBe("en");
    expect(matchLanguage([])).toBe("en");
  });
});

describe("translator", () => {
  it("formats a message in the chosen language", () => {
    expect(translator("en")(trayMessages.quit)).toBe("Quit Linger");
    expect(translator("zh-CN")(trayMessages.quit)).toBe(zhCN.tray.quit);
    expect(
      translator("zh-CN")(trayMessages.downloading, { version: "1.2.0" }),
    ).toBe(zhCN.tray.downloading.replace("{version}", "1.2.0"));
  });

  it("falls back to English for a message the catalog lacks", () => {
    const messages = defineMessages("tray", {
      notInTheCatalog: "Only in English {name}",
    });
    expect(
      translator("zh-CN")(messages.notInTheCatalog, { name: "Linger" }),
    ).toBe("Only in English Linger");
  });
});
