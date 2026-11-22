// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  formatLocale,
  resetLanguageForTest,
  setLanguage,
} from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { formatDateTime } from "@/lib/date-format";
import {
  acceptRoomUpdates,
  createTestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";

import { RoomSettingsDialog } from "./room-settings-dialog";
import { RoomHistoryShareDialog } from "./sharing/room-history-share-dialog";

const words = zhCN.roomSettings;

describe("Room settings in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("says in one sentence that a save was not confirmed", async () => {
    await setLanguage("zh-CN");
    const runtime = createTestTeamHubRuntime();
    acceptRoomUpdates(runtime);
    const room = await teamHubData(
      runtime.client.api.GET("/v0/rooms/{roomId}", {
        params: { path: { roomId: "room-all" } },
      }),
    );
    runtime.server.on("PATCH", "/v0/rooms/{roomId}", () => {
      throw new Error("Connection closed before confirmation.");
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            onClose={vi.fn()}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(zhCN.roomDialogs.roomName), {
      target: { value: "release-room" },
    });
    fireEvent.click(screen.getByRole("button", { name: words.saveChanges }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      words.saveUnconfirmed,
    );
  });

  it("counts messages and dates a shared snapshot", async () => {
    await setLanguage("zh-CN");
    const createdAt = "2026-09-22T06:30:03.000Z";
    const client = {
      roomHistory: {
        list: vi.fn().mockResolvedValue({
          items: [
            {
              id: "share_1",
              room_name: "Room",
              created_at: createdAt,
              message_count: 2,
              snapshot_room_seq: 4,
            },
          ],
        }),
        create: vi.fn(),
        link: vi.fn(),
        revoke: vi.fn(),
      },
    } as unknown as TeamHubClient;

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={{ client } as never}>
          <RoomHistoryShareDialog onClose={vi.fn()} roomId="room_1" />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("dialog", { name: words.shareConversation }),
    ).toBeVisible();
    expect(
      await screen.findByText(words.messageCount.other.replace("{count}", "2")),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: words.revoke })).toBeVisible();
    const date = formatDateTime(createdAt, undefined, formatLocale("zh-CN"));
    expect(
      screen.getByRole("button", {
        name: words.openSharedLinkFrom.replace("{date}", date),
      }),
    ).toBeVisible();
  });
});
