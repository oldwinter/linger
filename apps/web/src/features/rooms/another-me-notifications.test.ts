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

import { writeQuietUntil } from "./another-me-quiet";
import {
  anotherMeNotice,
  useAnotherMeNotifications,
} from "./another-me-notifications";
import {
  clearDesktopNotificationPause,
  setDesktopNotificationPause,
} from "./desktop-notification-pause";

const agent = {
  id: "actor_agent",
  tenant_id: "tenant_1",
  kind: "agent",
  display_name: "Another Me",
} as const;
const human = {
  ...agent,
  id: "actor_human",
  kind: "human",
  display_name: "Bo",
} as const;

function room(
  latest?: Partial<NonNullable<TeamHubRoomListItem["latest_message"]>>,
): TeamHubRoomListItem {
  return {
    id: "room_1",
    tenant_id: "tenant_1",
    kind: "direct",
    name: "Another Me",
    created_by: human,
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
    latest_room_seq: 2,
    read_through_room_seq: 1,
    unread_message_count: 1,
    unread_mention_count: 0,
    latest_message: latest
      ? {
          id: "msg_2",
          room_seq: 2,
          author: agent,
          raw_message: "**Sam's birthday** is in 12 days.",
          created_at: "2026-11-11T00:00:00Z",
          ...latest,
        }
      : undefined,
  };
}

describe("anotherMeNotice", () => {
  it("announces a new Message from the Another Me as plain text", () => {
    expect(anotherMeNotice(room({}), agent.id, "msg_1")).toEqual({
      messageId: "msg_2",
      title: "Another Me",
      body: "Sam's birthday is in 12 days.",
    });
  });

  it("stays quiet on the first reading, a seen Message, or the Human's own", () => {
    expect(anotherMeNotice(room({}), agent.id, undefined)).toBeUndefined();
    expect(anotherMeNotice(room({}), agent.id, "msg_2")).toBeUndefined();
    expect(
      anotherMeNotice(room({ author: human }), agent.id, "msg_1"),
    ).toBeUndefined();
    expect(anotherMeNotice(room(), agent.id, null)).toBeUndefined();
  });

  it("announces the first Message of an empty Chat", () => {
    expect(anotherMeNotice(room({}), agent.id, null)?.messageId).toBe("msg_2");
  });

  it("shortens a long Message", () => {
    const notice = anotherMeNotice(
      room({ raw_message: "a".repeat(400) }),
      agent.id,
      "msg_1",
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

function renderAnotherMe(
  rooms: TeamHubRoomListItem[],
  open: (roomId: string) => void,
  accountId?: string,
) {
  return renderHook(
    (props: { rooms: TeamHubRoomListItem[] }) =>
      useAnotherMeNotifications({
        accountId,
        agentActorId: agent.id,
        open,
        roomId: "room_1",
        rooms: props.rooms,
      }),
    { initialProps: { rooms } },
  );
}

describe("useAnotherMeNotifications", () => {
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
  });

  it("shows a new Another Me Message while unfocused", () => {
    const open = vi.fn();
    const { rerender } = renderAnotherMe(
      [room({ id: "msg_1", raw_message: "hello" })],
      open,
    );
    expect(FakeNotification.shown).toEqual([]);

    rerender({
      rooms: [room({ id: "msg_2", raw_message: "**Birthday** soon" })],
    });

    expect(FakeNotification.shown).toHaveLength(1);
    expect(FakeNotification.shown[0]?.title).toBe("Another Me");
    expect(FakeNotification.shown[0]?.body).toBe("Birthday soon");
  });

  it("keeps the notice back while paused and shows it after resuming", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    setDesktopNotificationPause("account-a", new Date("2026-11-15T10:30:00"));
    const open = vi.fn();
    const { rerender } = renderAnotherMe(
      [room({ id: "msg_1", raw_message: "hello" })],
      open,
      "account-a",
    );
    const reminder = [room({ id: "msg_2", raw_message: "Take a break" })];

    rerender({ rooms: reminder });
    expect(FakeNotification.shown).toEqual([]);

    act(() => clearDesktopNotificationPause("account-a"));

    expect(FakeNotification.shown).toHaveLength(1);
    expect(FakeNotification.shown[0]?.body).toBe("Take a break");
  });

  it("holds the system reminder while this computer is quiet", () => {
    writeQuietUntil("account-jenny", Date.now() + 60_000);
    const { rerender } = renderAnotherMe(
      [room({ id: "msg_1", raw_message: "hello" })],
      () => undefined,
      "account-jenny",
    );

    rerender({
      rooms: [room({ id: "msg_2", raw_message: "Take a break" })],
    });

    expect(FakeNotification.shown).toEqual([]);
  });
});
