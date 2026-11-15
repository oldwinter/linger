import { describe, expect, it } from "vitest";

import { messageLink, messageLinkId } from "./message-link";

const roomPath = "/t/tenant-1/rooms/room-all/chat";

describe("messageLink", () => {
  it("adds the Message to a Room path", () => {
    expect(messageLink(roomPath, "message-1")).toBe(
      "/t/tenant-1/rooms/room-all/chat?message=message-1",
    );
  });

  it("keeps a query string the Room path already has", () => {
    expect(messageLink(`${roomPath}?highlight=launch`, "message-1")).toBe(
      "/t/tenant-1/rooms/room-all/chat?highlight=launch&message=message-1",
    );
  });

  it("encodes a Message id and reads it back unchanged", () => {
    const link = messageLink(roomPath, "message/one two");

    expect(link).toBe(
      "/t/tenant-1/rooms/room-all/chat?message=message%2Fone%20two",
    );
    expect(messageLinkId(link)).toBe("message/one two");
  });
});

describe("messageLinkId", () => {
  it("round trips every link the builder makes", () => {
    for (const path of [roomPath, `${roomPath}?highlight=launch`]) {
      expect(messageLinkId(messageLink(path, "message-1"))).toBe("message-1");
    }
  });

  it("names no Message for a Room location alone", () => {
    expect(messageLinkId(roomPath)).toBeNull();
    expect(messageLinkId(`${roomPath}?highlight=launch`)).toBeNull();
    expect(messageLinkId(`${roomPath}?message=`)).toBeNull();
    expect(messageLinkId("")).toBeNull();
  });

  it("reads a full URL and ignores the fragment", () => {
    expect(
      messageLinkId(
        `https://rooms.example.com${roomPath}?message=message-1#reply-3`,
      ),
    ).toBe("message-1");
  });
});
