import { afterEach, describe, expect, it } from "vitest";

import type { TeamHubExternalApp } from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { appDescription } from "./app-groups";

afterEach(() => resetLanguageForTest());

function app(key: string, description: string) {
  return { description, key } as TeamHubExternalApp;
}

describe("appDescription", () => {
  it("words a catalog app's description by its key", async () => {
    await setLanguage("zh-CN");
    expect(
      appDescription(
        app("slack", "Connect workspaces and selected channels."),
        translate,
      ),
    ).toBe(zhCN.appDescriptions.slack);
  });

  it("keeps TeamHub's text for an app this client does not know", async () => {
    await setLanguage("zh-CN");
    expect(
      appDescription(app("jira", "Let Agents work with Jira."), translate),
    ).toBe("Let Agents work with Jira.");
  });

  it("shows TeamHub's own text in English, even where the copy differs", () => {
    expect(
      appDescription(app("slack", "Slack, as TeamHub now says it."), translate),
    ).toBe("Slack, as TeamHub now says it.");
  });
});
