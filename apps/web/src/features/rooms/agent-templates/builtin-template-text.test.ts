import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { templateDescription, templateName } from "./builtin-template-text";

afterEach(() => resetLanguageForTest());

describe("built-in template text", () => {
  it("words TeamHub's built-in templates by id", async () => {
    await setLanguage("zh-CN");
    const template = {
      description:
        "Reviews changes for correctness, risk, and clarity, and reports actionable findings.",
      name: "Code Reviewer",
      origin: "builtin",
      template_id: "code-reviewer",
    } as const;
    expect(templateName(template, translate)).toBe(
      zhCN.builtinTemplates.codeReviewerName,
    );
    expect(templateDescription(template, translate)).toBe(
      zhCN.builtinTemplates.codeReviewerDescription,
    );
  });

  it("keeps a published template's own words, even with a built-in id", async () => {
    await setLanguage("zh-CN");
    const template = {
      description: "My reviewer.",
      name: "Code Reviewer",
      origin: "published",
      template_id: "code-reviewer",
    } as const;
    expect(templateName(template, translate)).toBe("Code Reviewer");
    expect(templateDescription(template, translate)).toBe("My reviewer.");
  });

  it("keeps the text of a built-in template this client does not know", async () => {
    await setLanguage("zh-CN");
    const template = {
      description: "Writes release notes.",
      name: "Release Writer",
      origin: "builtin",
      template_id: "release-writer",
    } as const;
    expect(templateName(template, translate)).toBe("Release Writer");
  });

  it("shows TeamHub's own text in English, even where the copy differs", () => {
    const template = {
      description: "Reviews changes, as TeamHub now says it.",
      name: "Code Review",
      origin: "builtin",
      template_id: "code-reviewer",
    } as const;
    expect(templateName(template, translate)).toBe("Code Review");
    expect(templateDescription(template, translate)).toBe(
      "Reviews changes, as TeamHub now says it.",
    );
  });
});
