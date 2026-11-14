// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  roomMentionMessages,
  roomMentionNotices,
  useRoomMentionNotifications,
} from "./room-mention-notifications";
import {
  unmuteRoomMention,
  withRoomMentionMute,
  withRoomMentionSnooze,
  writeRoomMentionMute,
  writeRoomMentionSnooze,
} from "./room-mention-snooze";

const human = {
  id: "actor_human",
  tenant_id: "tenant_1",
  kind: "human",
  display_name: "Bo",
} as const;
const agent = {
  id: "actor_agent",
  tenant_id: "tenant_1",
  kind: "agent",
  display_name: "Ada",
} as const;

function room(
  id: string,
  input: {
    kind?: TeamHubRoomListItem["kind"];
    mentions?: number;
    message?: { id: string; text: string };
  } = {},
): TeamHubRoomListItem {
  return {
    id,
    tenant_id: "tenant_1",
    kind: input.kind ?? "room",
    name: `Room ${id}`,
    created_by: human,
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
    latest_room_seq: 2,
    read_through_room_seq: 1,
    unread_message_count: 2,
    unread_mention_count: input.mentions ?? 0,
    latest_message: input.message
      ? {
          id: input.message.id,
          room_seq: 2,
          author: agent,
          raw_message: input.message.text,
          created_at: "2026-11-11T00:00:00Z",
        }
      : undefined,
  };
}

describe("roomMentionNotices", () => {
  it("waits for the first reading to be recorded", () => {
    expect(
      roomMentionNotices(
        [
          room("a", {
            mentions: 1,
            message: { id: "msg_1", text: "@Bo look" },
          }),
        ],
        undefined,
        undefined,
      ),
    ).toEqual([]);
  });

  it("announces a new unread mention with the Room and an excerpt", () => {
    const seen = roomMentionMessages([
      room("a", { message: { id: "msg_1", text: "older" } }),
    ]);
    expect(
      roomMentionNotices(
        [
          room("a", {
            mentions: 1,
            message: { id: "msg_2", text: "**@Bo** please review" },
          }),
        ],
        undefined,
        seen,
      ),
    ).toEqual([
      {
        body: "@Bo please review",
        messageId: "msg_2",
        roomId: "a",
        title: "Room a",
      },
    ]);
  });

  it("announces each Message once and skips Rooms without new mentions", () => {
    const seen = roomMentionMessages([
      room("a", { message: { id: "msg_2", text: "@Bo look" } }),
      room("b", { message: { id: "msg_3", text: "@Bo too" } }),
    ]);
    expect(
      roomMentionNotices(
        [
          room("a", {
            mentions: 1,
            message: { id: "msg_2", text: "@Bo look" },
          }),
          room("b", { message: { id: "msg_3", text: "@Bo too" } }),
        ],
        undefined,
        seen,
      ),
    ).toEqual([]);
  });

  it("skips the open Room and Threads", () => {
    const seen = roomMentionMessages([room("open"), room("thread")]);
    expect(
      roomMentionNotices(
        [
          room("open", {
            mentions: 1,
            message: { id: "msg_1", text: "@Bo here" },
          }),
          room("thread", {
            kind: "thread",
            mentions: 1,
            message: { id: "msg_2", text: "@Bo there" },
          }),
        ],
        "open",
        seen,
      ),
    ).toEqual([]);
  });

  it("records a Room read for the first time instead of replaying it", () => {
    const seen = roomMentionMessages([room("a")]);
    const joined = room("joined", {
      mentions: 3,
      message: { id: "msg_9", text: "@Bo old mention" },
    });
    expect(roomMentionNotices([joined], undefined, seen)).toEqual([]);

    const recorded = roomMentionMessages([joined]);
    expect(
      roomMentionNotices(
        [
          room("joined", {
            mentions: 1,
            message: { id: "msg_10", text: "@Bo new mention" },
          }),
        ],
        undefined,
        recorded,
      ),
    ).toHaveLength(1);
  });

  it("shortens a long Message to an excerpt", () => {
    const seen = roomMentionMessages([room("a")]);
    const [notice] = roomMentionNotices(
      [
        room("a", {
          mentions: 1,
          message: { id: "msg_1", text: "a".repeat(400) },
        }),
      ],
      undefined,
      seen,
    );
    expect(notice?.body).toHaveLength(161);
  });
});

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static shown: FakeNotification[] = [];

  readonly body: string;
  closed = false;
  onclick: (() => void) | null = null;

  constructor(
    readonly title: string,
    options?: { body?: string },
  ) {
    this.body = options?.body ?? "";
    FakeNotification.shown.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

function renderNotifications(
  rooms: TeamHubRoomListItem[],
  open: (roomId: string, messageId?: string) => void,
  accountId?: string,
) {
  return renderHook(
    (props: { rooms: TeamHubRoomListItem[] }) =>
      useRoomMentionNotifications({
        accountId,
        open,
        roomId: undefined,
        rooms: props.rooms,
      }),
    { initialProps: { rooms } },
  );
}

describe("useRoomMentionNotifications", () => {
  beforeEach(() => {
    FakeNotification.permission = "granted";
    FakeNotification.shown = [];
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as { lingerDesktop?: unknown }).lingerDesktop;
  });

  it("shows a mention read while unfocused and opens its Room on click", () => {
    const open = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const baseline = [room("a", { message: { id: "msg_1", text: "hello" } })];
    const { rerender } = renderNotifications(baseline, open);
    expect(FakeNotification.shown).toEqual([]);

    rerender({
      rooms: [
        room("a", {
          mentions: 2,
          message: { id: "msg_2", text: "@Bo can you check this?" },
        }),
      ],
    });

    expect(FakeNotification.shown).toHaveLength(1);
    const [notification] = FakeNotification.shown;
    expect(notification?.title).toBe("Room a");
    expect(notification?.body).toBe("@Bo can you check this?");

    act(() => notification?.onclick?.());
    expect(focus).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("a", "msg_2");
    expect(notification?.closed).toBe(true);

    rerender({
      rooms: [
        room("a", {
          mentions: 2,
          message: { id: "msg_2", text: "@Bo can you check this?" },
        }),
      ],
    });
    expect(FakeNotification.shown).toHaveLength(1);
  });

  it("never shows anything while the window is focused", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const open = vi.fn();
    const { rerender } = renderNotifications(
      [room("a", { message: { id: "msg_1", text: "hello" } })],
      open,
    );
    rerender({
      rooms: [
        room("a", {
          mentions: 1,
          message: { id: "msg_2", text: "@Bo look" },
        }),
      ],
    });
    expect(FakeNotification.shown).toEqual([]);

    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    rerender({
      rooms: [
        room("a", {
          mentions: 1,
          message: { id: "msg_2", text: "@Bo look" },
        }),
      ],
    });
    expect(FakeNotification.shown).toEqual([]);
  });

  it("keeps a snoozed Room quiet and out of the badge until its expiry", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const setBadgeCount = vi.fn(async () => {});
    (window as { lingerDesktop?: unknown }).lingerDesktop = {
      notifications: { setBadgeCount },
    };
    const open = vi.fn();
    writeRoomMentionSnooze(
      "account-a",
      withRoomMentionSnooze({}, "a", new Date("2026-11-15T10:30:00")),
    );
    const { rerender } = renderNotifications(
      [
        room("a", { message: { id: "msg_1", text: "hello" } }),
        room("b", { message: { id: "msg_9", text: "hi" } }),
      ],
      open,
      "account-a",
    );
    expect(setBadgeCount).toHaveBeenLastCalledWith(0);

    rerender({
      rooms: [
        room("a", { mentions: 2, message: { id: "msg_2", text: "@Bo look" } }),
        room("b", { mentions: 1, message: { id: "msg_10", text: "@Bo too" } }),
      ],
    });
    expect(FakeNotification.shown.map((notice) => notice.title)).toEqual([
      "Room b",
    ]);
    expect(setBadgeCount).toHaveBeenLastCalledWith(1);

    // The snooze expires on its own; the next reading sees the Room again.
    vi.setSystemTime(new Date("2026-11-15T10:31:00"));
    rerender({
      rooms: [
        room("a", { mentions: 2, message: { id: "msg_3", text: "@Bo again" } }),
        room("b", { mentions: 1, message: { id: "msg_10", text: "@Bo too" } }),
      ],
    });
    expect(FakeNotification.shown.map((notice) => notice.title)).toEqual([
      "Room b",
      "Room a",
    ]);
    expect(setBadgeCount).toHaveBeenLastCalledWith(3);
  });

  it("keeps a muted Room quiet and out of the badge until it is unmuted", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const setBadgeCount = vi.fn(async () => {});
    (window as { lingerDesktop?: unknown }).lingerDesktop = {
      notifications: { setBadgeCount },
    };
    const open = vi.fn();
    writeRoomMentionMute("account-a", withRoomMentionMute(new Set(), "a"));
    const { rerender } = renderNotifications(
      [
        room("a", { message: { id: "msg_1", text: "hello" } }),
        room("b", { message: { id: "msg_9", text: "hi" } }),
      ],
      open,
      "account-a",
    );
    expect(setBadgeCount).toHaveBeenLastCalledWith(0);

    rerender({
      rooms: [
        room("a", { mentions: 2, message: { id: "msg_2", text: "@Bo look" } }),
        room("b", { mentions: 1, message: { id: "msg_10", text: "@Bo too" } }),
      ],
    });
    expect(FakeNotification.shown.map((notice) => notice.title)).toEqual([
      "Room b",
    ]);
    expect(setBadgeCount).toHaveBeenLastCalledWith(1);

    act(() => unmuteRoomMention("account-a", "a"));
    rerender({
      rooms: [
        room("a", { mentions: 2, message: { id: "msg_3", text: "@Bo again" } }),
        room("b", { mentions: 1, message: { id: "msg_10", text: "@Bo too" } }),
      ],
    });
    expect(FakeNotification.shown.map((notice) => notice.title)).toEqual([
      "Room b",
      "Room a",
    ]);
    expect(setBadgeCount).toHaveBeenLastCalledWith(3);
  });

  it("keeps the app badge on the total unread mentions", () => {
    const setBadgeCount = vi.fn(async () => {});
    (window as { lingerDesktop?: unknown }).lingerDesktop = {
      notifications: { setBadgeCount },
    };
    const open = vi.fn();
    const { rerender } = renderNotifications(
      [
        room("a", { mentions: 2 }),
        room("b", { mentions: 1 }),
        room("c", { mentions: 0 }),
      ],
      open,
    );
    expect(setBadgeCount).toHaveBeenCalledWith(3);

    rerender({ rooms: [room("a"), room("b"), room("c")] });
    expect(setBadgeCount).toHaveBeenLastCalledWith(0);
    expect(setBadgeCount).toHaveBeenCalledTimes(2);
  });
});
