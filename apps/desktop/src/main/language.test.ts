import { describe, expect, it, vi } from "vitest";

import zhCN from "../i18n/locales/zh-CN.json" with { type: "json" };
import { LanguageModule } from "./language.js";
import { EventBus } from "./modules.js";
import { stubModule, testHost } from "./test-support.js";
import { trayMessages } from "./tray.messages.js";

const fixture = async (systemLanguages: string[], stored?: "en" | "zh-CN") => {
  const bus = new EventBus();
  const changed = vi.fn();
  bus.on("language.changed", changed);
  const language = new LanguageModule({
    systemLanguages: () => systemLanguages,
  });
  const host = testHost(
    [stubModule("Config"), language],
    stored ? { language: stored } : {},
    bus,
  );
  await host.start();
  return { language, host, changed };
};

describe("LanguageModule", () => {
  it("follows the system until the Web client reports a choice", async () => {
    const zh = await fixture(["zh-Hans-CN", "en-US"]);
    expect(zh.language.current()).toBe("zh-CN");
    expect(zh.language.t(trayMessages.quit)).toBe(zhCN.tray.quit);
    await zh.host.stop("quit");

    const other = await fixture(["fr-FR"]);
    expect(other.language.current()).toBe("en");
    expect(other.language.t(trayMessages.quit)).toBe("Quit Linger");
    await other.host.stop("quit");
  });

  it("keeps the choice over the system's languages", async () => {
    const f = await fixture(["zh-CN"], "en");
    expect(f.language.current()).toBe("en");
    await f.host.stop("quit");
  });

  it("announces a choice only when the shell's text changes", async () => {
    const f = await fixture(["zh-CN"]);
    // Choosing what the system already gave keeps the text as it is.
    f.language.choose("zh-CN");
    expect(f.changed).not.toHaveBeenCalled();
    f.language.choose("en");
    expect(f.changed).toHaveBeenCalledExactlyOnceWith("en");
    expect(f.language.current()).toBe("en");
    await f.host.stop("quit");
  });
});
