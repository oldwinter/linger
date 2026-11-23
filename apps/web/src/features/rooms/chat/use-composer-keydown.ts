import type { KeyboardEvent } from "react";

import type { ComposerDraft } from "./use-composer-draft";
import type { ComposerHistory } from "./use-composer-history";
import {
  adjacentMentionTab,
  adjacentSelectableIndex,
  type ComposerPicker,
} from "./use-composer-picker";
import type { ComposerQuoteReply } from "./use-composer-quote-reply";
import type { ComposerReferenceInsertion } from "./use-composer-reference-insertion";
import type { ComposerSend } from "./use-composer-send";

export interface ComposerKeyDownInput {
  clearReplyContext?: () => void;
  draft: ComposerDraft;
  history: ComposerHistory;
  insertion: ComposerReferenceInsertion;
  picker: ComposerPicker;
  quoteReply: ComposerQuoteReply;
  sending: ComposerSend;
}

/**
 * Picker navigation, sent-message history and Enter-to-send, deferring to an
 * open IME composition.
 */
export function useComposerKeyDown({
  clearReplyContext,
  draft: { isComposing },
  history: { step },
  insertion: { insertAtPickerItem, insertSkill },
  picker: {
    activeMentionIndex,
    activePickerLength,
    applyMentionQuery,
    atPickerItems,
    availableMentionTabs,
    matchingSkills,
    mentionQuery,
    mentionTab,
    selectablePickerIndices,
    setMentionSelection,
    setMentionTab,
    setSkillQuery,
    skillQuery,
  },
  quoteReply: { dismissQuoteReply, stagedQuoteReply },
  sending: { send },
}: ComposerKeyDownInput) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isComposing.current || event.nativeEvent.isComposing) {
      return;
    }

    if ((mentionQuery || skillQuery) && activePickerLength) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionSelection(
          adjacentSelectableIndex(
            selectablePickerIndices,
            activeMentionIndex,
            1,
          ),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionSelection(
          adjacentSelectableIndex(
            selectablePickerIndices,
            activeMentionIndex,
            -1,
          ),
        );
        return;
      }
      if (
        (event.key === "Enter" && !event.shiftKey) ||
        (event.key === "Tab" && !event.shiftKey)
      ) {
        event.preventDefault();
        if (skillQuery) {
          insertSkill(matchingSkills[activeMentionIndex]!);
        } else {
          insertAtPickerItem(atPickerItems[activeMentionIndex]!);
        }
        return;
      }
    }

    if (
      mentionQuery &&
      mentionQuery.query.length === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      setMentionTab(
        adjacentMentionTab(
          mentionTab,
          event.key === "ArrowRight" ? 1 : -1,
          availableMentionTabs,
        ),
      );
      setMentionSelection(0);
      return;
    }

    if (
      (mentionQuery || skillQuery) &&
      (event.key === "Home" ||
        event.key === "End" ||
        (Boolean(skillQuery) &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")))
    ) {
      applyMentionQuery(null);
      setSkillQuery(null);
      return;
    }

    if (event.key === "Escape" && (mentionQuery || skillQuery)) {
      event.preventDefault();
      event.stopPropagation();
      applyMentionQuery(null);
      setSkillQuery(null);
      return;
    }

    // The picker owns Escape while it is open, so a staged quote is only
    // dismissed once no suggestion is showing.
    if (event.key === "Escape" && stagedQuoteReply) {
      event.preventDefault();
      event.stopPropagation();
      dismissQuoteReply();
      return;
    }

    if (event.key === "Escape" && clearReplyContext) {
      event.preventDefault();
      event.stopPropagation();
      clearReplyContext();
      return;
    }

    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !mentionQuery &&
      !skillQuery &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      // Read-only while sending or in Voice Mode.
      !event.currentTarget.readOnly &&
      step(event.key === "ArrowUp" ? -1 : 1, event.currentTarget)
    ) {
      event.preventDefault();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void send();
  }

  return { handleKeyDown };
}
