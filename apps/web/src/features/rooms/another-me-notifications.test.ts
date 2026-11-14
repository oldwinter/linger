// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { writeQuietUntil } from "./another-me-quiet";
import {
  anotherMeNotice,
  useAnotherMeNotifications,
} from "./another-me-notifications";

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

describe("Another Me reminder delivery", () => {
  const shown: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    globalThis.localStorage?.clear();
    shown.length = 0;
  });

  function deliver(messageId: string) {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.stubGlobal(
      "Notification",
      class FakeNotification {
        static permission = "granted";
        onclick: (() => void) | null = null;
        constructor(title: string) {
          shown.push(title);
        }
        close() {}
      },
    );
    return renderHook(
      ({ id }: { id: string }) =>
        useAnotherMeNotifications({
          accountId: "account-jenny",
          agentActorId: agent.id,
          open: () => undefined,
          roomId: "room_1",
          rooms: [room({ id })],
        }),
      { initialProps: { id: messageId } },
    );
  }

  it("shows a system reminder when this computer is not quiet", () => {
    const view = deliver("msg_1");
    view.rerender({ id: "msg_2" });
    expect(shown).toEqual(["Another Me"]);
  });

  it("holds the system reminder while this computer is quiet", () => {
    writeQuietUntil("account-jenny", Date.now() + 60_000);
    const view = deliver("msg_1");
    view.rerender({ id: "msg_2" });
    expect(shown).toEqual([]);
  });
});
