// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { documentFileName } from "@/features/library/document-display-name";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import {
  createDocumentTestRuntime,
  seedRoomDocument,
} from "@/test/document-scenarios";

import { FileLibraryPanelTab } from "./file-library-panel-tab";

const words = zhCN.roomDocuments;

describe("Room Files tab in the language on screen", () => {
  afterEach(() => resetLanguageForTest());

  it("words the list, its actions and the date", async () => {
    const runtime = createDocumentTestRuntime();
    const document = seedRoomDocument(runtime, "room-files-language-1");
    render(
      <TeamHubRuntimeProvider runtime={runtime}>
        <FileLibraryPanelTab documents={[document]} onOpenDocument={() => {}} />
      </TeamHubRuntimeProvider>,
    );
    expect(
      screen.getByRole("navigation", { name: "Room files" }),
    ).toBeVisible();
    expect(screen.getByText("1 file")).toBeVisible();
    const english = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(document.updated_at));
    expect(screen.getByText(english)).toBeVisible();

    await act(() => setLanguage("zh-CN"));
    expect(
      screen.getByRole("navigation", { name: words.roomFiles }),
    ).toBeVisible();
    expect(
      screen.getByText(words.fileCount.other.replace("{count}", "1")),
    ).toBeVisible();
    expect(screen.queryByText(english)).toBeNull();
    expect(
      screen.getByText(
        new Intl.DateTimeFormat("zh-CN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(new Date(document.updated_at)),
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: words.downloadFile.replace("{name}", documentFileName(document)),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: words.actionsFor.replace("{name}", documentFileName(document)),
      }),
    ).toBeVisible();
  });

  it("words the empty list", async () => {
    await setLanguage("zh-CN");
    render(
      <TeamHubRuntimeProvider runtime={createDocumentTestRuntime()}>
        <FileLibraryPanelTab documents={[]} onOpenDocument={() => {}} />
      </TeamHubRuntimeProvider>,
    );
    expect(screen.getByText(words.noDocumentsYet)).toBeVisible();
    expect(screen.getByText(words.emptyTitle)).toBeVisible();
    expect(screen.getByText(words.emptyBody)).toBeVisible();
  });
});
