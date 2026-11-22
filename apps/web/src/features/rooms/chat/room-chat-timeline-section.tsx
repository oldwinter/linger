import { type ComponentProps, useEffect, useMemo, useState } from "react";

import { isRunWorking } from "@/features/teamhub/run-status";
import { useT, useTranslation } from "@/i18n/use-translation";

import { chatMessages } from "./chat.messages";

import { EarlierConversationBar } from "./earlier-conversation-bar";
import {
  conversationBeganAt,
  earlierConversationEnd,
} from "./earlier-conversation";
import { formatMessageTime, timelineMessages } from "./message-grouping";
import { useWritingSeat } from "./writing-seat";
import { JumpToLatestButton } from "./jump-to-latest-button";
import { MessageTimeline } from "./message-timeline";
import { roomAgreedMessage } from "./room-agreed";
import { RoomAgreedLine } from "./room-agreed-line";
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
  const translation = useTranslation();
  const {
    actorItems,
    linkedInTimeline,
    linkedMessage,
    identity,
    linkedMessageId,
    members,
    messages,
    roomId,
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
  const writingSeatText = useWritingSeat({
    accountId: identity.account.id,
    roomId,
    tenantId,
  });
  // A voice draft or a message already on its way owns the end of the room.
  const writingSeat =
    voiceLiveDraft || conversation.pendingMessages.length > 0
      ? undefined
      : writingSeatText;
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
        beganAt={beganAt ? formatMessageTime(beganAt, translation) : undefined}
        canGoEarlier={earlierEnd !== undefined}
        onEarlier={() => {
          if (earlierEnd) setAsOf(earlierEnd);
        }}
        onNow={() => setAsOf(undefined)}
        rewound={asOf !== undefined}
      />
      <RoomTimelineViewport
        agentWorking={conversation.streamingRunStatuses.some(isRunWorking)}
        awayFromLatest={asOf !== undefined || timeline.awayFromLatest}
        onJumpToLatest={() => {
          setAsOf(undefined);
          timeline.scrollToLatest();
        }}
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
        writingSeat={writingSeat}
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
        onRestoreToDraft={async (clientId) => {
          const pending = conversation.pendingMessages.find(
            (item) => item.clientId === clientId,
          );
          if (!pending || !interactions.composerRef.current) return;
          interactions.composerRef.current.restoreDraft({
            body: pending.body,
            mentions: pending.mentions,
          });
          if (pending.contextMessages.length) {
            interactions.holdReply(pending.contextMessages[0]!);
          }
          await delivery.cancelMessage(clientId);
        }}
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
  agentWorking: boolean;
  awayFromLatest: boolean;
  initialScrollReady: boolean;
  onJumpToLatest: () => void;
  onJumpToUnread: () => void;
  showUnreadJump: boolean;
  viewportOnScroll: NonNullable<ComponentProps<"div">["onScroll"]>;
  viewportRef: ComponentProps<"div">["ref"];
};

function RoomTimelineViewport({
  agentWorking,
  awayFromLatest,
  initialScrollReady,
  onJumpToLatest,
  onJumpToUnread,
  showUnreadJump,
  viewportOnScroll,
  viewportRef,
  ...timelineProps
}: RoomTimelineViewportProps) {
  const t = useT();
  const agreed = useMemo(() => {
    const memberIds = timelineProps.memberActorIds;
    const actorKinds = timelineProps.actorKinds;
    if (!memberIds || !actorKinds) return;
    const humanIds = [...memberIds].filter((id) => actorKinds[id] === "human");
    return roomAgreedMessage(timelineProps.messages, humanIds);
  }, [
    timelineProps.actorKinds,
    timelineProps.memberActorIds,
    timelineProps.messages,
  ]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {agreed ? <RoomAgreedLine message={agreed} /> : null}
      <div
        aria-label={t(chatMessages.roomTimeline)}
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
      {showUnreadJump ? (
        <RoomUnreadJump aboveLatest={awayFromLatest} onJump={onJumpToUnread} />
      ) : null}
      {awayFromLatest ? (
        <JumpToLatestButton
          agentWorking={agentWorking}
          onClick={onJumpToLatest}
        />
      ) : null}
    </div>
  );
}
