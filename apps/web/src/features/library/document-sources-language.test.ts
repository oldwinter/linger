import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import {
  documentSourceLabel,
  documentSourceLabels,
} from "./document-source-label";

describe("Document sources in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("words the Personal Wiki in Chinese and keeps Room names as sent", async () => {
    await setLanguage("zh-CN");
    const sources = [
      { binding_kind: "room", label: "Planning" },
      { binding_kind: "wiki_page", label: "Personal Wiki" },
      { binding_kind: "wiki_source", label: "Personal Wiki" },
    ] as const;

    expect(documentSourceLabels(sources, translate, () => "")).toEqual([
      "Planning",
      zhCN.documentSources.personalWiki,
    ]);
  });

  it("lists Rooms that share a name each time", async () => {
    await setLanguage("zh-CN");
    const sources = [
      { binding_kind: "room", label: "Planning" },
      { binding_kind: "wiki_page", label: "Personal Wiki" },
      { binding_kind: "room", label: "Planning" },
    ] as const;

    expect(documentSourceLabels(sources, translate, () => "")).toEqual([
      "Planning",
      zhCN.documentSources.personalWiki,
      "Planning",
    ]);
  });

  it("names the Personal Wiki even when TeamHub sends no label", async () => {
    await setLanguage("zh-CN");

    expect(
      documentSourceLabel({ binding_kind: "wiki_source" }, translate),
    ).toBe(zhCN.documentSources.personalWiki);
    expect(
      documentSourceLabel({ binding_kind: "task" }, translate),
    ).toBeUndefined();
  });
});
