import { type ComponentProps, useEffect, useMemo, useState } from "react";

import { EarlierConversationBar } from "./earlier-conversation-bar";
import {
  conversationBeganAt,
  earlierConversationEnd,
} from "./earlier-conversation";
import { formatMessageTime, timelineMessages } from "./message-grouping";
import { MessageTimeline } from "./message-timeline";
import { RoomUnreadJump } from "./room-unread-jump";
import { findUnreadDividerIndex } from "./unread-divider";
import type { RoomChatData } from "./use-room-chat-data";
import type { RoomChatConversationState } from "./use-room-chat-conversation-state";
import type { RoomChatTimelineActions } from "./use-room-chat-timeline-actions";

interface RoomChatTimelineSectionProps {
  actions: RoomChatTimelineActions;
  data: RoomChatData;
  state: RoomChatConversationState;
}

/** The scrolling Room timeline, including a linked Message outside it. */
export function RoomChatTimelineSection({
  actions,
  data,
  state,
}: RoomChatTimelineSectionProps) {
  const {
    actorItems,
    linkedInTimeline,
    linkedMessage,
    linkedMessageId,
    members,
    messages,
    navigation,
    setCreateIssueMessage,
    setForwardMessage,
    tenantId,
  } = data;
  const {
    agentStreaming,
    conversation,
    currentActorId,
    delivery,
    documentMetadata,
    documentTitles,
    interactions,
    linkedPresentedMessage,
    mentionOptions,
    onboarding,
    presentedMessages,
    readBoundary,
    timeline,
    voiceLiveDraft,
  } = state;
  const [asOf, setAsOf] = useState<string>();
  const earlierEnd = earlierConversationEnd(presentedMessages, asOf);
  const visibleMessages = useMemo(
    () =>
      asOf === undefined
        ? presentedMessages
        : presentedMessages.filter((message) => message.created_at <= asOf),
    [asOf, presentedMessages],
  );
  const beganAt =
    asOf === undefined
      ? undefined
      : conversationBeganAt(presentedMessages, asOf);
  // Sending belongs to the live room, so a message on its way brings it back.
  useEffect(() => {
    if (conversation.pendingMessages.length > 0) setAsOf(undefined);
  }, [conversation.pendingMessages.length]);
  const unreadDivider = useMemo(
    () =>
      readBoundary
        ? findUnreadDividerIndex(
            timelineMessages(visibleMessages),
            readBoundary.readThroughRoomSeq,
          )
        : ({ kind: "none" } as const),
    [readBoundary, visibleMessages],
  );
  const unreadDividerIndex =
    unreadDivider.kind === "none"
      ? undefined
      : unreadDivider.kind === "beyond-page"
        ? 0
        : unreadDivider.index;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EarlierConversationBar
        beganAt={beganAt ? formatMessageTime(beganAt) : undefined}
        canGoEarlier={earlierEnd !== undefined}
        onEarlier={() => {
          if (earlierEnd) setAsOf(earlierEnd);
        }}
        onNow={() => setAsOf(undefined)}
        rewound={asOf !== undefined}
      />
      <RoomTimelineViewport
        actorDisplayNames={actions.actorDisplayNames}
        canLoadOlder={messages.hasNextPage}
        currentActorId={currentActorId}
        documentTitles={documentTitles}
        documentMetadata={documentMetadata}
        initialScrollReady={timeline.initialScrollReady}
        loadingOlder={messages.isFetchingNextPage}
        linkedSource={
          linkedMessageId && !linkedInTimeline
            ? linkedMessage.isError
              ? {
                  kind: "error",
                  retry: () => void linkedMessage.refetch(),
                }
              : linkedMessage.data
                ? {
                    kind: "ready",
                    message: linkedPresentedMessage!,
                  }
                : { kind: "loading" }
            : undefined
        }
        messages={visibleMessages}
        messagesArriving={onboarding.messagesHeld}
        voiceLiveDraft={voiceLiveDraft ?? undefined}
        runStatuses={conversation.streamingRunStatuses}
        runtimePresentationEventsByRunStatusId={
          agentStreaming.runtimePresentationEventsByRunStatusId
        }
        mentionableActorIds={new Set(mentionOptions.map((actor) => actor.id))}
        memberActorIds={new Set(members.items.map((member) => member.actor.id))}
        onCancel={delivery.cancelMessage}
        onCardDecision={actions.timelineActions.onCardDecision}
        onCloseLinkedSource={navigation.closeLinkedMessage}
        onToggleReaction={conversation.toggleReaction}
        onTogglePin={conversation.togglePin}
        pinnedMessageIds={conversation.pinnedMessageIds}
        actorKinds={actions.actorKinds}
        onCreateIssueMessage={setCreateIssueMessage}
        onForwardMessage={setForwardMessage}
        onMentionAuthor={interactions.mentionAuthor}
        onOpenMessageFile={navigation.openMessageFile}
        onOpenArtifact={navigation.previewArtifact}
        onOpenProfile={actions.openActorProfile}
        onOpenAgentActivity={(actorId, runStatusId, runId) => {
          const actor = actorItems.find(
            (candidate) => candidate.id === actorId,
          );
          if (actor) {
            if (runStatusId)
              navigation.openLiveActivity(actor, runStatusId, runId);
            else navigation.openAgentActivity(actor);
          }
        }}
        onOpenDirectChat={actions.openDirectChat}
        onOpenUrl={actions.timelineActions.onOpenUrl}
        onOpenThread={navigation.openThread}
        onReply={interactions.replyToMessage}
        onReplyWithQuote={
          // A structured reply already stages the same Message as context, so
          // the quote action steps aside rather than stacking a second strip.
          interactions.selectedContextMessages.length
            ? undefined
            : interactions.stageQuoteReply
        }
        onRetry={delivery.retryMessage}
        pendingMessages={conversation.pendingMessages}
        presentations={actions.resolvedPresentations}
        selectedContextMessageIds={
          new Set(
            interactions.selectedContextMessages.map((message) => message.id),
          )
        }
        tenantId={tenantId}
        workspaceAgentIds={actions.workspaceAgentIds}
        focusedMessageId={linkedInTimeline ? linkedMessageId : undefined}
        focusedMessageHighlight={
          linkedInTimeline ? navigation.linkedMessageHighlight : undefined
        }
        onJumpToUnread={timeline.jumpToUnreadDivider}
        showUnreadJump={
          unreadDividerIndex !== undefined &&
          timeline.initialScrollReady &&
          !timeline.unreadDividerVisible
        }
        unreadDividerIndex={unreadDividerIndex}
        unreadDividerRef={timeline.unreadDividerRef}
        viewportOnScroll={(event) => {
          timeline.recordTimelineScroll(event.currentTarget);
          actions.loadOlderNearTop(event.currentTarget);
        }}
        viewportRef={timeline.timelineRef}
      />
    </div>
  );
}

type RoomTimelineViewportProps = ComponentProps<typeof MessageTimeline> & {
  initialScrollReady: boolean;
  onJumpToUnread: () => void;
  showUnreadJump: boolean;
  viewportOnScroll: NonNullable<ComponentProps<"div">["onScroll"]>;
  viewportRef: ComponentProps<"div">["ref"];
};

function RoomTimelineViewport({
  initialScrollReady,
  onJumpToUnread,
  showUnreadJump,
  viewportOnScroll,
  viewportRef,
  ...timelineProps
}: RoomTimelineViewportProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        aria-label="Room timeline"
        data-voice-scroll="main"
        className={`room-timeline workspace-scrollbar flex flex-1 flex-col overflow-y-scroll [overflow-anchor:none] ${
          initialScrollReady ? "" : "invisible"
        }`}
        data-initial-scroll-ready={initialScrollReady}
        onScroll={viewportOnScroll}
        ref={viewportRef}
      >
        <MessageTimeline {...timelineProps} />
      </div>
      {showUnreadJump ? <RoomUnreadJump onJump={onJumpToUnread} /> : null}
    </div>
  );
}
