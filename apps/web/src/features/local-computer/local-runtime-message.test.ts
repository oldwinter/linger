import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { localRuntimeMessage } from "./local-runtime-message";

afterEach(() => resetLanguageForTest());

describe("localRuntimeMessage", () => {
  it("words a known code in the interface language", async () => {
    await setLanguage("zh-CN");
    expect(
      localRuntimeMessage(
        {
          error_code: "RUNTIME_NOT_INSTALLED",
          message: "Runtime executable not found",
        },
        "codex",
        "Studio Mac",
        translate,
      ),
    ).toBe(
      zhCN.localRuntimeMessage.notInstalled
        .replace("{computer}", "Studio Mac")
        .replace("{app}", "Codex"),
    );
  });

  it("words a known code in English", () => {
    expect(
      localRuntimeMessage(
        {
          error_code: "LOCAL_COMPUTER_OFFLINE",
          message: "Local Computer is offline",
        },
        "claude",
        "Studio Mac",
        translate,
      ),
    ).toBe("Studio Mac is offline.");
  });

  it("keeps the Runtime's diagnostic as TeamHub sent it", async () => {
    await setLanguage("zh-CN");
    expect(
      localRuntimeMessage(
        {
          error_code: "RUNTIME_DIAGNOSTIC_FAILED",
          message: "Claude authentication status probe failed",
        },
        "claude",
        "Studio Mac",
        translate,
      ),
    ).toBe("Claude authentication status probe failed");
  });

  it("falls back to TeamHub's English for an unknown or missing code", async () => {
    await setLanguage("zh-CN");
    expect(
      localRuntimeMessage(
        { error_code: "RUNTIME_QUOTA_EXCEEDED", message: "Quota exceeded" },
        "pi",
        "Studio Mac",
        translate,
      ),
    ).toBe("Quota exceeded");
    expect(
      localRuntimeMessage({}, "pi", "Studio Mac", translate),
    ).toBeUndefined();
  });
});
