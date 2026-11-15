import { useEffect, useRef } from "react";

import type {
  TeamHubActorRef,
  TeamHubMessage,
} from "@/features/teamhub/teamhub-types";

import { formatMentionToken } from "./message-mentions";
import type { MessageComposerHandle } from "./message-composer";
import { readRoomComposerDraft, type RoomDraftScope } from "../room-drafts";
import { latestUnansweredNaming } from "./unanswered-naming";

/**
 * When someone you named has not answered for an hour, an empty composer
 * becomes a follow-up to them on that message. An edited follow-up stays.
 * Their answer removes a follow-up that was not edited.
 */
export function useUnansweredFollowUp({
  clearContext,
  composerRef,
  currentActorId,
  draftScope,
  enabled,
  holdReply,
  mentionOptions,
  messages,
  selectedContextMessages,
}: {
  clearContext: () => void;
  composerRef: { current: MessageComposerHandle | null };
  currentActorId: string | undefined;
  draftScope: RoomDraftScope;
  enabled: boolean;
  holdReply: (message: TeamHubMessage) => void;
  mentionOptions: readonly TeamHubActorRef[];
  messages: readonly TeamHubMessage[];
  selectedContextMessages: readonly TeamHubMessage[];
}) {
  const offered = useRef<{ messageId: string; token: string } | undefined>(
    undefined,
  );
  const live = useRef({
    clearContext,
    draftScope,
    holdReply,
    mentionOptions,
    selectedContextMessages,
  });
  const naming = latestUnansweredNaming(messages, currentActorId);
  const namingKey = naming
    ? `${naming.message.id}\u0000${naming.actorId}\u0000${naming.dueAt}`
    : "";
  const namingRef = useRef(naming);
  useEffect(() => {
    live.current = {
      clearContext,
      draftScope,
      holdReply,
      mentionOptions,
      selectedContextMessages,
    };
    namingRef.current = naming;
  });

  useEffect(() => {
    if (!enabled) return;
    const naming = namingRef.current;
    let timer: number | undefined;
    const retract = () => {
      const placed = offered.current;
      if (!placed) return;
      offered.current = undefined;
      const { clearContext: clear, draftScope: scope } = live.current;
      const draft = readRoomComposerDraft(scope);
      const context = live.current.selectedContextMessages;
      if (
        draft.body.trim() !== placed.token ||
        context.length !== 1 ||
        context[0]?.id !== placed.messageId
      ) {
        return;
      }
      composerRef.current?.clearCommittedBody(placed.token);
      clear();
    };
    if (!naming) {
      retract();
      return;
    }
    if (offered.current && offered.current.messageId !== naming.message.id)
      retract();
    const offer = () => {
      if (offered.current?.messageId === naming.message.id) return;
      if (
        document.querySelector("[role='dialog'], [role='alertdialog']") ||
        !composerRef.current
      ) {
        timer = window.setTimeout(offer, 1_000);
        return;
      }
      const {
        draftScope: scope,
        holdReply: hold,
        mentionOptions: options,
      } = live.current;
      const draft = readRoomComposerDraft(scope);
      if (draft.body.trim() || draft.voiceMaterials?.length) return;
      if (live.current.selectedContextMessages.length > 0) return;
      const actor = options.find((item) => item.id === naming.actorId);
      if (!actor) return;
      const token = formatMentionToken(actor);
      offered.current = { messageId: naming.message.id, token };
      hold(naming.message);
      composerRef.current.insertMentionQuietly(actor);
    };
    timer = window.setTimeout(offer, Math.max(0, naming.dueAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [composerRef, enabled, namingKey]);
}
