import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { findUnreadDividerIndex } from "./unread-divider";

describe("Unread divider placement", () => {
  it("finds the first Message after the read boundary", () => {
    expect(
      findUnreadDividerIndex(
        [message("m1", 5), message("m2", 15), message("m3", 25)],
        10,
      ),
    ).toEqual({ index: 1, kind: "visible" });
  });

  it("places nothing when the read boundary covers every loaded Message", () => {
    expect(
      findUnreadDividerIndex([message("m1", 5), message("m2", 15)], 15),
    ).toEqual({ kind: "none" });
  });

  it("places nothing in an empty timeline", () => {
    expect(findUnreadDividerIndex([], 10)).toEqual({ kind: "none" });
  });

  it("reports a boundary older than the loaded page", () => {
    expect(
      findUnreadDividerIndex([message("m1", 15), message("m2", 25)], 10),
    ).toEqual({ kind: "beyond-page" });
  });

  it("places the divider above a Room notice the reader had not seen", () => {
    expect(
      findUnreadDividerIndex(
        [
          message("m1", 5),
          message("notice", 15, { message_kind: "room_notice" }),
        ],
        10,
      ),
    ).toEqual({ index: 1, kind: "visible" });
  });

  it("places nothing when the Messages predate room_seq", () => {
    expect(findUnreadDividerIndex([message("m1"), message("m2")], 10)).toEqual({
      kind: "none",
    });
  });
});

function message(
  id: string,
  roomSeq?: number,
  overrides: Partial<TeamHubMessage> = {},
): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Agent",
      id: "agent-1",
      kind: "agent",
      tenant_id: "tenant-1",
    },
    created_at: "2026-10-22T10:00:00Z",
    id,
    message_kind: "conversation",
    raw_message: id,
    room_id: "room-1",
    segments: [{ type: "text", content: id }],
    tenant_id: "tenant-1",
    ...(roomSeq === undefined ? {} : { room_seq: roomSeq }),
    ...overrides,
  };
}
