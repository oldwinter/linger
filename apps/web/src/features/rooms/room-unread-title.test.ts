// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  roomWindowTitle,
  unreadTitleLabel,
  useRoomWindowTitle,
} from "./room-unread-title";

const originalTitle = document.title;

beforeEach(() => {
  document.title = "Linger";
});

afterEach(() => {
  document.title = originalTitle;
});

describe("unread title label", () => {
  it("leaves the title alone when nothing is unread", () => {
    expect(unreadTitleLabel([room()])).toBeNull();
    expect(roomWindowTitle("Jenny's space", [room()])).toBe("Jenny's space");
  });

  it("counts unread Messages", () => {
    expect(
      unreadTitleLabel([
        room({ id: "room-a", unread_message_count: 2 }),
        room({ id: "room-b", unread_message_count: 1 }),
      ]),
    ).toBe("(3)");
  });

  it("counts unread mentions a Room reports without their Messages", () => {
    expect(unreadTitleLabel([room({ unread_mention_count: 2 })])).toBe("(2)");
  });

  it("does not count a mention twice when its Room counts the Message", () => {
    expect(
      unreadTitleLabel([
        room({ unread_mention_count: 2, unread_message_count: 5 }),
      ]),
    ).toBe("(5)");
    expect(
      roomWindowTitle("Jenny's space", [
        room({ unread_mention_count: 2, unread_message_count: 5 }),
      ]),
    ).toBe("(5) Jenny's space");
  });

  it("bounds a large count", () => {
    expect(unreadTitleLabel([room({ unread_message_count: 150 })])).toBe(
      "(99+)",
    );
  });

  it("leaves Threads to the parent Room's count", () => {
    expect(
      unreadTitleLabel([
        room({ id: "room-thread", kind: "thread", unread_message_count: 4 }),
      ]),
    ).toBeNull();
  });
});

describe("useRoomWindowTitle", () => {
  it("prefixes unread activity and restores the mount-time title", () => {
    const initialProps: {
      rooms: readonly TeamHubRoomListItem[] | undefined;
    } = { rooms: undefined };
    const { rerender, unmount } = renderHook(
      ({ rooms }: { rooms: readonly TeamHubRoomListItem[] | undefined }) =>
        useRoomWindowTitle({ baseTitle: "Jenny's space", rooms }),
      { initialProps },
    );

    expect(document.title).toBe("Jenny's space");

    rerender({ rooms: [room({ unread_message_count: 2 })] });
    expect(document.title).toBe("(2) Jenny's space");

    rerender({ rooms: [room({ unread_message_count: 0 })] });
    expect(document.title).toBe("Jenny's space");

    rerender({ rooms: [room({ unread_message_count: 1 })] });
    unmount();
    expect(document.title).toBe("Linger");
  });
});

function room(
  override: Partial<TeamHubRoomListItem> = {},
): TeamHubRoomListItem {
  return {
    created_at: "2026-07-23T09:00:00Z",
    created_by: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    id: "room-a",
    kind: "room",
    latest_room_seq: 1,
    name: "all",
    read_through_room_seq: 1,
    tenant_id: "tenant-northstar",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-07-23T09:00:00Z",
    ...override,
  };
}
