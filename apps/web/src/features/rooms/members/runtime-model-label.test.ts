import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { runtimeModelLabel } from "./runtime-model-label";

afterEach(() => resetLanguageForTest());

describe("runtimeModelLabel", () => {
  it("words TeamHub's stand-in default model by its id", async () => {
    await setLanguage("zh-CN");
    expect(
      runtimeModelLabel(
        { id: "codex-default", label: "Codex default" },
        translate,
      ),
    ).toBe(zhCN.runtimeModel.hostDefault.replace("{app}", "Codex"));
  });

  it("keeps the label a Runtime reported for its own models", async () => {
    await setLanguage("zh-CN");
    expect(
      runtimeModelLabel({ id: "gpt-5.5", label: "GPT-5.5" }, translate),
    ).toBe("GPT-5.5");
  });

  it("shows the label TeamHub sent in English", () => {
    expect(
      runtimeModelLabel(
        { id: "codex-default", label: "Codex's default model" },
        translate,
      ),
    ).toBe("Codex's default model");
  });
});
