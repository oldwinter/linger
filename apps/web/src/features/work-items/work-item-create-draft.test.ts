import { describe, expect, it } from "vitest";

import { messageQuoteText } from "@/features/rooms/chat/message-quote";

import {
  messageWorkItemDraft,
  WORK_ITEM_TITLE_LIMIT,
  workItemTitle,
} from "./work-item-create-draft";

const message = {
  authorName: "Maya Chen",
  createdAt: "2026-07-23T09:12:00Z",
  roomId: "room-all",
};

describe("Work Item drafts from Messages", () => {
  it("takes the first readable line and quotes the whole Message", () => {
    const raw = "First readable line.\n\nSecond paragraph with **details**.";

    const draft = messageWorkItemDraft({ ...message, message: raw });

    expect(draft.title).toBe("First readable line.");
    expect(draft.originRoomId).toBe("room-all");
    expect(draft.description).toBe(
      messageQuoteText({
        authorName: "Maya Chen",
        createdAt: "2026-07-23T09:12:00Z",
        message: raw,
      }),
    );
  });

  it("drops Markdown noise from the title", () => {
    expect(
      messageWorkItemDraft({
        ...message,
        message: "## Release notes\n\n**Ship** the build",
      }).title,
    ).toBe("Release notes");
    expect(
      messageWorkItemDraft({ ...message, message: "- [ ] Check the checklist" })
        .title,
    ).toBe("Check the checklist");
  });

  it("opens an empty title when the Message has no readable text", () => {
    for (const raw of ["", "---\n\n***", "```\n```"]) {
      expect(messageWorkItemDraft({ ...message, message: raw }).title).toBe("");
    }
  });

  it("bounds a long line to the contract limit", () => {
    const title = workItemTitle("a".repeat(300));

    expect(title).toHaveLength(WORK_ITEM_TITLE_LIMIT);
    expect(title).toBe("a".repeat(WORK_ITEM_TITLE_LIMIT));
  });

  it("never leaves half of a surrogate pair at the limit", () => {
    // 239 units plus an emoji: a plain 240-unit cut would keep its high half.
    const title = workItemTitle(`${"a".repeat(239)}\u{1F600}tail`);

    expect(title).toBe("a".repeat(239));
  });
});
