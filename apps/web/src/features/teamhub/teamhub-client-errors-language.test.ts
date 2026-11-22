import { afterEach, describe, expect, it, vi } from "vitest";

import { roomMessagesInfiniteQueryOptions } from "@/features/rooms/room-queries";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { collectTeamHubCursorPages } from "./teamhub-cursor-pages";

const errors = zhCN.teamHubClientErrors;

describe("Client errors about TeamHub responses in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("words a repeated or endless directory cursor in Chinese", async () => {
    await setLanguage("zh-CN");
    const repeated = vi.fn().mockResolvedValue({
      items: [],
      page: { has_more: true, next_cursor: "repeated" },
    });
    await expect(collectTeamHubCursorPages(repeated)).rejects.toMatchObject({
      code: "INVALID_PAGINATION",
      message: errors.invalidCursor,
    });

    let page = 0;
    const endless = vi.fn().mockImplementation(async () => ({
      items: [],
      page: { has_more: true, next_cursor: `cursor-${(page += 1)}` },
    }));
    await expect(collectTeamHubCursorPages(endless)).rejects.toMatchObject({
      code: "PAGINATION_LIMIT_EXCEEDED",
      message: errors.directoryTooLong,
    });
  });

  it("words a repeated Room Message cursor in Chinese", async () => {
    await setLanguage("zh-CN");
    const options = roomMessagesInfiniteQueryOptions(
      createTestTeamHubRuntime().client,
      "tenant-northstar",
      "room-all",
    );
    const page = {
      items: [],
      page: { has_more: true, next_cursor: "cursor-a" },
      snapshot_room_seq: 0,
    };

    expect(() =>
      options.getNextPageParam(page, [page], "cursor-a", [
        undefined,
        "cursor-a",
      ]),
    ).toThrow(errors.invalidRoomMessageCursor);
  });
});
