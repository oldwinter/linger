// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  TeamHubActorRef,
  TeamHubMessage,
} from "@/features/teamhub/teamhub-types";

import type { MessageComposerHandle } from "./message-composer";
import { formatMentionToken } from "./message-mentions";
import {
  readRoomComposerDraft,
  writeRoomComposerDraft,
  type RoomDraftScope,
} from "../room-drafts";
import { useUnansweredFollowUp } from "./use-unanswered-follow-up";

const scope: RoomDraftScope = {
  accountId: "account-jenny",
  roomId: "room-1",
  tenantId: "tenant-1",
};
const mina: TeamHubActorRef = {
  display_name: "Mina",
  id: "human-mina",
  kind: "human",
  tenant_id: "tenant-1",
};

function asked(createdAt: string): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Jenny",
      id: "human-jenny",
      kind: "human",
      tenant_id: "tenant-1",
    },
    created_at: createdAt,
    id: "asked",
    message_kind: "conversation",
    raw_message: "@Mina can you send the deck?",
    room_id: "room-1",
    segments: [
      {
        type: "reference",
        content: "@Mina",
        target: mina.id,
        target_type: "user",
      },
      { type: "text", content: " can you send the deck?" },
    ],
    tenant_id: "tenant-1",
  };
}

function followUp(messages: TeamHubMessage[]) {
  const composer = {
    clearCommittedBody: vi.fn(),
    insertMentionQuietly: vi.fn(),
  } as unknown as MessageComposerHandle;
  const clearContext = vi.fn();
  const holdReply = vi.fn();
  const view = renderHook(
    (current: TeamHubMessage[]) =>
      useUnansweredFollowUp({
        clearContext,
        composerRef: { current: composer },
        currentActorId: "human-jenny",
        draftScope: scope,
        enabled: true,
        holdReply,
        mentionOptions: [mina],
        messages: current,
        selectedContextMessages: holdReply.mock.calls.length
          ? [asked(current[0]?.created_at ?? "")]
          : [],
      }),
    { initialProps: messages },
  );
  return { clearContext, composer, holdReply, view };
}

describe("useUnansweredFollowUp", () => {
  afterEach(() => {
    vi.useRealTimers();
    writeRoomComposerDraft(scope, {
      body: "",
      documentContexts: [],
      documentReferences: [],
      mentions: [],
      skillReferences: [],
    });
  });

  it("turns an empty composer into a follow-up once the hour has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T08:30:00.000Z"));
    const { composer, holdReply } = followUp([
      asked("2026-11-16T08:00:00.000Z"),
    ]);
    void act(() => vi.advanceTimersByTime(29 * 60 * 1000));
    expect(holdReply).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(60 * 1000));
    expect(holdReply).toHaveBeenCalledOnce();
    expect(composer.insertMentionQuietly).toHaveBeenCalledWith(mina);
  });

  it("leaves a composer that already has words", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
    writeRoomComposerDraft(scope, {
      body: "Still writing",
      documentContexts: [],
      documentReferences: [],
      mentions: [],
      skillReferences: [],
    });
    const { composer, holdReply } = followUp([
      asked("2026-11-16T08:00:00.000Z"),
    ]);
    void act(() => vi.runAllTimers());
    expect(holdReply).not.toHaveBeenCalled();
    expect(composer.insertMentionQuietly).not.toHaveBeenCalled();
  });

  it("removes the follow-up when they answer and it was not edited", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
    const { clearContext, composer, view } = followUp([
      asked("2026-11-16T08:00:00.000Z"),
    ]);
    void act(() => vi.runAllTimers());
    writeRoomComposerDraft(scope, {
      body: `${formatMentionToken(mina)} `,
      documentContexts: [],
      documentReferences: [],
      mentions: [mina],
      skillReferences: [],
    });
    expect(readRoomComposerDraft(scope).body.trim()).toBe(
      formatMentionToken(mina),
    );
    view.rerender([
      asked("2026-11-16T08:00:00.000Z"),
      {
        ...asked("2026-11-16T10:05:00.000Z"),
        author: mina,
        id: "answered",
        raw_message: "Sent",
        segments: [{ type: "text", content: "Sent" }],
      },
    ]);
    void act(() => vi.runAllTimers());
    expect(composer.clearCommittedBody).toHaveBeenCalledWith(
      formatMentionToken(mina),
    );
    expect(clearContext).toHaveBeenCalled();
  });
});
