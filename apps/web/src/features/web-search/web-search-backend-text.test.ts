import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import {
  webSearchBackendDescription,
  webSearchBackendFreeTier,
  webSearchBackendFreeUse,
} from "./web-search-backend-text";

afterEach(() => resetLanguageForTest());

const tavily = {
  description: "The real-time search engine for AI agents.",
  free_tier: "1,000 free API credits every month.",
  id: "tavily",
} as const;

describe("web search backend text", () => {
  it("words a known backend's text by its id", async () => {
    await setLanguage("zh-CN");
    expect(webSearchBackendDescription(tavily, translate)).toBe(
      zhCN.webSearchBackendText.descriptionTavily,
    );
    expect(webSearchBackendFreeTier(tavily, translate)).toBe(
      zhCN.webSearchBackendText.freeTierTavily,
    );
  });

  it("shows nothing TeamHub did not send", async () => {
    await setLanguage("zh-CN");
    expect(webSearchBackendFreeUse(tavily, translate)).toBeUndefined();
  });

  it("keeps TeamHub's English for a backend this client does not know", async () => {
    await setLanguage("zh-CN");
    const backend = {
      description: "A new search API.",
      free_tier: "Free for a week.",
      id: "newsearch" as never,
    };
    expect(webSearchBackendDescription(backend, translate)).toBe(
      "A new search API.",
    );
    expect(webSearchBackendFreeTier(backend, translate)).toBe(
      "Free for a week.",
    );
  });

  it("shows TeamHub's own text in English, even where the copy differs", () => {
    const changed = {
      ...tavily,
      free_tier: "500 free API credits every month.",
    };
    expect(webSearchBackendFreeTier(changed, translate)).toBe(
      "500 free API credits every month.",
    );
    expect(webSearchBackendDescription(changed, translate)).toBe(
      tavily.description,
    );
  });
});
