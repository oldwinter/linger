// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { panelTabText } from "./panel-tab-label";
import {
  PANEL_COLLECTION_TAB_IDS,
  PANEL_COLLECTION_TAB_TITLES,
  type PanelTab,
} from "./panel-tab-types";

function tab(input: Partial<PanelTab> & Pick<PanelTab, "kind">): PanelTab {
  return { id: "tab", lastActivatedAt: 1, title: "", ...input };
}

afterEach(() => {
  resetLanguageForTest();
});

describe("panel tab text", () => {
  it("words an Agent tab from the saved name", () => {
    expect(panelTabText(tab({ kind: "agentInfo", title: "Codex" }))).toEqual({
      label: "Agent · Codex",
      name: "Codex",
    });
    expect(
      panelTabText(tab({ kind: "agentActivity", title: "Codex" })),
    ).toEqual({ label: "Activity · Codex", name: "Codex" });
    expect(panelTabText(tab({ kind: "agentInfo" })).label).toBe(
      "Agent · Agent",
    );
  });

  it("reads titles saved with the English wording", async () => {
    const info = tab({ kind: "agentInfo", title: "Agent · Codex" });
    const activity = tab({ kind: "agentActivity", title: "Activity · Codex" });
    expect(panelTabText(info).label).toBe("Agent · Codex");
    expect(panelTabText(activity).name).toBe("Codex");

    await setLanguage("zh-CN");
    expect(panelTabText(activity)).toEqual({
      label: zhCN.sidePanel.activityTab.replace("{name}", "Codex"),
      name: "Codex",
    });
  });

  it("names a collection tab after its kind, whatever was saved", async () => {
    const files = tab({
      id: PANEL_COLLECTION_TAB_IDS.file,
      kind: "file",
      title: PANEL_COLLECTION_TAB_TITLES.file,
    });
    const settings = tab({
      id: PANEL_COLLECTION_TAB_IDS.roomSettings,
      kind: "roomSettings",
      title: zhCN.chat.roomSettings,
    });
    expect(panelTabText(files).label).toBe("Files");
    expect(panelTabText(settings).label).toBe("Room settings");

    await setLanguage("zh-CN");
    expect(panelTabText(files).label).toBe(zhCN.sidePanel.filesTab);
    expect(panelTabText(settings).label).toBe(zhCN.chat.roomSettings);
  });

  it("keeps names that are data and words an empty one", () => {
    expect(
      panelTabText(tab({ documentId: "doc-1", kind: "file", title: "Files" }))
        .label,
    ).toBe("Files");
    expect(panelTabText(tab({ kind: "url", title: "example.com" })).label).toBe(
      "example.com",
    );
    const message = { anchorMessageId: "message-1", kind: "thread" } as const;
    expect(panelTabText(tab({ ...message, title: "Ship it" })).label).toBe(
      "Ship it",
    );
    expect(panelTabText(tab(message)).label).toBe("Untitled");
  });

  it("words a Message tab saved as Untitled", async () => {
    const saved = tab({
      anchorMessageId: "message-1",
      kind: "thread",
      title: "Untitled",
    });
    await setLanguage("zh-CN");
    expect(panelTabText(saved).label).toBe(zhCN.sidePanel.untitledTab);
    expect(panelTabText({ ...saved, title: "" }).label).toBe(
      zhCN.sidePanel.untitledTab,
    );
  });
});
