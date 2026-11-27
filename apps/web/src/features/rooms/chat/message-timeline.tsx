import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  formatMessageTime,
  isRoomNotice,
  messageStartsConversation,
  timeStartsConversation,
} from "./message-grouping";
import { sameMomentStarts } from "./same-moment";
import { pairedAgentAnswers } from "./paired-agent-answers";
import { Icon } from "@/components/ui/icon";
import { runtimeStatusMessages as m } from "../runtime-status/runtime-status.messages";
import { AgentAvatarStatusContext } from "../members/agent-avatar-status-context";
import { Fragment, type RefObject, useMemo, useRef } from "react";
import { commonMessages } from "@/i18n/common.messages";
import { useT, useTranslation } from "@/i18n/use-translation";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  TeamHubDocumentPreviewTarget,
  TeamHubMessagePresentation,
} from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubActorRef,
  TeamHubMessage,
  TeamHubMessageDocumentSegment,
  TeamHubRunStatus,
  TeamHubMessageFileSegment,
  TeamHubMessageReactionId,
  TeamHubRuntimePresentationEventRecord,
} from "@/features/teamhub/teamhub-types";

import {
  VoiceLiveDraftRow,
  type VoiceLiveDraft,
} from "./voice-mode/voice-live-draft";
import { WritingSeatRow } from "./writing-seat-row";
import type { RoomCardDecision } from "../cards/room-message-card-contract";
import type { DocumentCardMetadata } from "../files/document-card-metadata";
import {
  MessageRow,
  PendingMessageRow,
  type PendingRoomMessage,
} from "./message-row";
import type { StagedQuoteReply } from "./quote-reply";
import {
  LoadingOlderMessages,
  MessageTimelineEmptyState,
} from "./message-timeline-placeholders";
import { useMessageFilePreview } from "./use-message-file-preview";
import { useTimelineMessageGroups } from "./use-timeline-message-groups";
import {
  avatarStatus,
  buildRuntimeTimelineViews,
  isLiveAgentRunStatus,
  type RuntimeTimelineViewCache,
} from "./agent-streaming-status-dock";

const EMPTY_LABELS: Readonly<Record<string, string>> = {};
const EMPTY_ACTOR_KINDS: Readonly<Record<string, "human" | "agent">> = {};
const EMPTY_DOCUMENT_METADATA: Readonly<Record<string, DocumentCardMetadata>> =
  {};
const EMPTY_RUN_STATUSES: TeamHubRunStatus[] = [];
const EMPTY_RUNTIME_EVENTS: Readonly<
  Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
> = {};

const EMPTY_STATIC_AGENT_ACTOR_IDS: ReadonlySet<string> = new Set();

type LinkedSourceMessage =
  | { kind: "error"; retry: () => void }
  | { kind: "loading" }
  | { kind: "ready"; message: TeamHubMessage };

interface MessageTimelineProps {
  actorDisplayNames?: Readonly<Record<string, string>>;
  canLoadOlder: boolean;
  currentActorId?: string;
  documentTitles?: Readonly<Record<string, string>>;
  documentMetadata?: Readonly<Record<string, DocumentCardMetadata>>;
  loadingOlder: boolean;
  linkedSource?: LinkedSourceMessage;
  messageFilePreview?: "enabled" | "disabled";
  messages: TeamHubMessage[];
  /** Messages are about to appear, so an empty Room is not a fresh start. */
  messagesArriving?: boolean;
  runStatuses?: readonly TeamHubRunStatus[];
  voiceLiveDraft?: VoiceLiveDraft;
  /** Unsent composer words, shown in the writer's place until they are sent. */
  writingSeat?: string;
  memberActorIds?: ReadonlySet<string>;
  mentionableActorIds?: ReadonlySet<string>;
  onCancel: (clientId: string) => Promise<void> | void;
  onCardDecision: (decision: RoomCardDecision) => Promise<void> | void;
  onCloseLinkedSource: () => void;
  onOpenMessageFile: (
    segment: TeamHubMessageFileSegment | TeamHubMessageDocumentSegment,
  ) => Promise<void>;
  onOpenArtifact: (document: TeamHubDocumentPreviewTarget) => void;
  onOpenThread?: (
    message: TeamHubMessage,
    options?: { focusComposer?: boolean },
  ) => void;
  onOpenProfile: (actorId: string) => void;
  onOpenAgentActivity?: (
    actorId: string,
    runStatusId?: string,
    runId?: string,
  ) => void;
  onOpenDirectChat?: (actorId: string) => void;
  onOpenUrl?: (url: string) => void;
  onMentionAuthor?: (actor: TeamHubActorRef) => void;
  onCreateIssueMessage?: (message: TeamHubMessage) => void;
  onForwardMessage?: (message: TeamHubMessage) => void;
  onReply?: (message: TeamHubMessage) => void;
  onReplyWithQuote?: (reply: StagedQuoteReply) => void;
  onToggleReaction?: (
    message: TeamHubMessage,
    reactionId: TeamHubMessageReactionId,
  ) => Promise<void>;
  onTogglePin?: (message: TeamHubMessage, pinned: boolean) => Promise<void>;
  pinnedMessageIds?: ReadonlySet<string>;
  actorKinds?: Readonly<Record<string, "human" | "agent">>;
  onRestoreToDraft?: (clientId: string) => Promise<void> | void;
  onRetry: (clientId: string) => void;
  pendingMessages: PendingRoomMessage[];
  presentations: Record<string, TeamHubMessagePresentation>;
  runtimePresentationEventsByRunStatusId?: Readonly<
    Record<string, readonly TeamHubRuntimePresentationEventRecord[]>
  >;
  selectedContextMessageIds?: ReadonlySet<string>;
  tenantId: string;
  focusedMessageId?: string | null;
  focusedMessageHighlight?: string | null;
  /** Index of the first unread Message; the divider renders above it. */
  unreadDividerIndex?: number;
  unreadDividerRef?: RefObject<HTMLDivElement | null>;
  workspaceAgentIds?: ReadonlySet<string>;
}

export function MessageTimeline({
  actorDisplayNames = EMPTY_LABELS,
  canLoadOlder,
  currentActorId,
  documentTitles = EMPTY_LABELS,
  documentMetadata = EMPTY_DOCUMENT_METADATA,
  loadingOlder,
  linkedSource,
  messageFilePreview = "enabled",
  messages,
  messagesArriving = false,
  runStatuses = EMPTY_RUN_STATUSES,
  voiceLiveDraft,
  writingSeat,
  memberActorIds = EMPTY_STATIC_AGENT_ACTOR_IDS,
  mentionableActorIds = EMPTY_STATIC_AGENT_ACTOR_IDS,
  onCancel,
  onCardDecision,
  onCloseLinkedSource,
  onOpenMessageFile,
  onOpenArtifact,
  onOpenThread,
  onOpenProfile,
  onOpenAgentActivity,
  onOpenDirectChat,
  onOpenUrl,
  onMentionAuthor,
  onCreateIssueMessage,
  onForwardMessage,
  onReply,
  onReplyWithQuote,
  onToggleReaction,
  onTogglePin,
  pinnedMessageIds = EMPTY_STATIC_AGENT_ACTOR_IDS,
  actorKinds = EMPTY_ACTOR_KINDS,
  onRestoreToDraft,
  onRetry,
  pendingMessages,
  presentations,
  runtimePresentationEventsByRunStatusId = EMPTY_RUNTIME_EVENTS,
  selectedContextMessageIds = EMPTY_STATIC_AGENT_ACTOR_IDS,
  tenantId,
  focusedMessageId,
  focusedMessageHighlight,
  unreadDividerIndex,
  unreadDividerRef,
  workspaceAgentIds = EMPTY_STATIC_AGENT_ACTOR_IDS,
}: MessageTimelineProps) {
  const translation = useTranslation();
  const { t } = translation;
  const { filePreviewError, previewMessageFile } =
    useMessageFilePreview(onOpenMessageFile);
  const referenceTitles = useMemo(
    () => ({
      ...documentTitles,
      ...Object.fromEntries(
        Object.entries(documentMetadata).map(([id, document]) => [
          id,
          document.title,
        ]),
      ),
    }),
    [documentMetadata, documentTitles],
  );
  const { candidateMessages, openedAtNewest, startsOwnGroup } =
    useTimelineMessageGroups(messages, currentActorId);
  const answerPairs = useMemo(
    () => pairedAgentAnswers(candidateMessages),
    [candidateMessages],
  );
  const answerPairAt = useMemo(() => {
    const claimed = new Set<number>();
    const covered = new Set<number>();
    const starts = new Map<
      number,
      { end: number; parentId: string; start: number }
    >();
    for (const pair of answerPairs) {
      starts.set(pair.start, pair);
      claimed.add(pair.start);
      for (let index = pair.start + 1; index <= pair.end; index += 1) {
        claimed.add(index);
        covered.add(index);
      }
    }
    return { claimed, covered, starts };
  }, [answerPairs]);
  // Paired agent answers take precedence over same-moment grouping so neither
  // group can skip an index that the other expects to render.
  const momentStarts = useMemo(
    () => new Set(sameMomentStarts(candidateMessages, answerPairAt.claimed)),
    [answerPairAt.claimed, candidateMessages],
  );
  const runtimeViewCache = useRef<RuntimeTimelineViewCache>(new Map());
  const runtimeStatusViews = useMemo(
    () =>
      buildRuntimeTimelineViews({
        cache: runtimeViewCache.current,
        runStatuses,
        runtimePresentationEventsByRunStatusId,
        t,
      }),
    [runStatuses, runtimePresentationEventsByRunStatusId, t],
  );
  const hasTimelineContent = Boolean(
    candidateMessages.length ||
    pendingMessages.length ||
    voiceLiveDraft ||
    writingSeat,
  );
  const avatarContext = useMemo(
    () => ({
      statuses: new Map(
        runtimeStatusViews.flatMap((row) =>
          isLiveAgentRunStatus(row)
            ? [[row.runStatus.agent.id, avatarStatus(row, t)] as const]
            : [],
        ),
      ),
      onOpenProfile,
      onOpenActivityLog: (actorId: string) => {
        const active = runtimeStatusViews.find(
          (row) =>
            row.runStatus.agent.id === actorId && isLiveAgentRunStatus(row),
        );
        onOpenAgentActivity?.(
          actorId,
          active?.runStatus.id,
          active?.runStatus.run_id,
        );
      },
    }),
    [onOpenProfile, onOpenAgentActivity, runtimeStatusViews, t],
  );
  const renderMessage = (
    message: TeamHubMessage,
    index: number,
    hideTime = false,
  ) => {
    const previous = candidateMessages[index - 1];
    const startsConversation =
      !hideTime && messageStartsConversation(message, previous);
    return (
      <Fragment key={message.id}>
        {startsConversation ? (
          <div className="room-conversation-time text-center text-xs text-app-subtle">
            <time dateTime={message.created_at}>
              {formatMessageTime(message.created_at, translation)}
            </time>
          </div>
        ) : null}
        {index === unreadDividerIndex ? (
          <div
            aria-label="New messages"
            className="flex items-center gap-2.5 py-1.5"
            ref={unreadDividerRef}
            role="separator"
          >
            <span
              aria-hidden="true"
              className="h-px flex-1 bg-(--app-unread)/40"
            />
            <span className="shrink-0 text-2xs font-medium text-(--app-unread)">
              New messages
            </span>
            <span
              aria-hidden="true"
              className="h-px flex-1 bg-(--app-unread)/40"
            />
          </div>
        ) : null}
        <MessageRow
          entering={message.created_at > openedAtNewest}
          showAuthor={
            startsConversation ||
            previous?.author.id !== message.author.id ||
            isRoomNotice(previous)
          }
          actorDisplayNames={actorDisplayNames}
          currentActorId={currentActorId}
          documentTitles={referenceTitles}
          documentMetadata={documentMetadata}
          message={message}
          messageFilePreview={messageFilePreview}
          canMentionAuthor={mentionableActorIds.has(message.author.id)}
          isAuthorMember={memberActorIds.has(message.author.id)}
          onCardDecision={onCardDecision}
          onOpenArtifact={onOpenArtifact}
          onOpenMessageFile={previewMessageFile}
          presentation={presentations[message.id]}
          onOpenProfile={onOpenProfile}
          onOpenDirectChat={onOpenDirectChat}
          onOpenUrl={onOpenUrl}
          onOpenThread={onOpenThread}
          onMentionAuthor={onMentionAuthor}
          onCreateIssueMessage={onCreateIssueMessage}
          onForwardMessage={onForwardMessage}
          onReply={onReply}
          onReplyWithQuote={onReplyWithQuote}
          onToggleReaction={onToggleReaction}
          onTogglePin={onTogglePin}
          isPinned={pinnedMessageIds.has(message.id)}
          actorKinds={actorKinds}
          selectedAsContext={selectedContextMessageIds.has(message.id)}
          tenantId={tenantId}
          focused={message.id === focusedMessageId}
          focusHighlight={
            message.id === focusedMessageId
              ? focusedMessageHighlight
              : undefined
          }
          workspaceAgentIds={workspaceAgentIds}
        />
      </Fragment>
    );
  };

  return (
    <AgentAvatarStatusContext.Provider value={avatarContext}>
      {linkedSource ? (
        <LinkedSourceMessagePanel
          actorDisplayNames={actorDisplayNames}
          currentActorId={currentActorId}
          documentTitles={referenceTitles}
          documentMetadata={documentMetadata}
          linkedSource={linkedSource}
          messageFilePreview={messageFilePreview}
          memberActorIds={memberActorIds}
          mentionableActorIds={mentionableActorIds}
          onClose={onCloseLinkedSource}
          onCardDecision={onCardDecision}
          onOpenArtifact={onOpenArtifact}
          onOpenMessageFile={previewMessageFile}
          onOpenProfile={onOpenProfile}
          onOpenUrl={onOpenUrl}
          onOpenThread={onOpenThread}
          onMentionAuthor={onMentionAuthor}
          onReply={onReply}
          onReplyWithQuote={onReplyWithQuote}
          presentations={presentations}
          selectedContextMessageIds={selectedContextMessageIds}
          tenantId={tenantId}
          workspaceAgentIds={workspaceAgentIds}
        />
      ) : null}
      <div
        className={`room-readable px-0 ${hasTimelineContent || canLoadOlder ? "pt-3 pb-8" : "my-auto py-5"}`}
      >
        {/* Earlier Messages load as the reader scrolls near the top. */}
        {loadingOlder ? <LoadingOlderMessages /> : null}

        {hasTimelineContent ? (
          <div className="room-message-list flex flex-col gap-1">
            {candidateMessages.map((message, index) => {
              if (
                answerPairAt.covered.has(index) ||
                momentStarts.has(index - 1)
              )
                return null;
              const pair = answerPairAt.starts.get(index);
              if (pair) {
                return (
                  <div
                    className="grid items-start gap-1 md:grid-cols-2"
                    data-paired-answers={pair.parentId}
                    key={message.id}
                  >
                    {candidateMessages
                      .slice(pair.start, pair.end + 1)
                      .map((answer, offset) =>
                        renderMessage(answer, pair.start + offset, offset > 0),
                      )}
                  </div>
                );
              }
              const next = candidateMessages[index + 1];
              if (!momentStarts.has(index) || !next) {
                return renderMessage(message, index);
              }
              return (
                <div
                  aria-label="Said at the same moment"
                  className="grid items-start gap-x-4 md:grid-cols-2"
                  key={message.id}
                  role="group"
                >
                  {renderMessage(message, index)}
                  {renderMessage(next, index + 1)}
                </div>
              );
            })}
            {pendingMessages.map((message, index) => {
              // A sending Message shows the time line its committed row
              // will show, so the commit does not insert one above it.
              const startsConversation = timeStartsConversation(
                message.createdAt,
                index > 0
                  ? pendingMessages[index - 1]!.createdAt
                  : candidateMessages.at(-1)?.created_at,
              );
              return (
                <Fragment key={message.clientId}>
                  {startsConversation ? (
                    <div className="room-conversation-time text-center text-xs text-app-subtle">
                      <time
                        dateTime={new Date(message.createdAt).toISOString()}
                      >
                        {formatMessageTime(
                          new Date(message.createdAt).toISOString(),
                          translation,
                        )}
                      </time>
                    </div>
                  ) : null}
                  <PendingMessageRow
                    actorId={currentActorId}
                    actorName={
                      actorDisplayNames[currentActorId ?? ""] ??
                      t(commonMessages.you)
                    }
                    startsGroup={
                      startsConversation || (index === 0 && startsOwnGroup)
                    }
                    message={message}
                    onCancel={onCancel}
                    onOpenProfile={onOpenProfile}
                    onRestoreToDraft={onRestoreToDraft}
                    onRetry={onRetry}
                  />
                </Fragment>
              );
            })}
            {voiceLiveDraft ? (
              <VoiceLiveDraftRow
                draft={voiceLiveDraft}
                startsGroup={pendingMessages.length === 0 && startsOwnGroup}
              />
            ) : writingSeat ? (
              <WritingSeatRow
                actorId={currentActorId}
                name={
                  (currentActorId
                    ? actorDisplayNames[currentActorId]
                    : undefined) ?? t(commonMessages.you)
                }
                startsGroup={pendingMessages.length === 0 && startsOwnGroup}
                text={writingSeat}
              />
            ) : null}
          </div>
        ) : messagesArriving ? null : (
          <MessageTimelineEmptyState />
        )}
      </div>
      {filePreviewError ? (
        <p className="room-readable mb-2 text-xs text-app-danger" role="alert">
          {filePreviewError}
        </p>
      ) : null}
    </AgentAvatarStatusContext.Provider>
  );
}

export {
  AgentStreamingStatusDock,
  buildRuntimeTimelineViews,
  hasAgentStreamingDockEntries,
  type AgentStreamingTypingAgent,
} from "./agent-streaming-status-dock";

function LinkedSourceMessagePanel({
  actorDisplayNames,
  currentActorId,
  documentTitles,
  documentMetadata,
  linkedSource,
  messageFilePreview,
  memberActorIds,
  mentionableActorIds,
  onClose,
  onCardDecision,
  onOpenArtifact,
  onOpenMessageFile,
  onOpenProfile,
  onOpenUrl,
  onOpenThread,
  onMentionAuthor,
  onReply,
  onReplyWithQuote,
  presentations,
  selectedContextMessageIds,
  tenantId,
  workspaceAgentIds,
}: {
  actorDisplayNames: Readonly<Record<string, string>>;
  currentActorId?: string;
  documentTitles: Readonly<Record<string, string>>;
  documentMetadata: Readonly<Record<string, DocumentCardMetadata>>;
  linkedSource: LinkedSourceMessage;
  messageFilePreview: "enabled" | "disabled";
  memberActorIds: ReadonlySet<string>;
  mentionableActorIds: ReadonlySet<string>;
  onClose: () => void;
  onCardDecision: (decision: RoomCardDecision) => Promise<void> | void;
  onOpenArtifact: (document: TeamHubDocumentPreviewTarget) => void;
  onOpenMessageFile: (
    segment: TeamHubMessageFileSegment | TeamHubMessageDocumentSegment,
  ) => void;
  onOpenProfile: (actorId: string) => void;
  onOpenUrl?: (url: string) => void;
  onOpenThread?: (
    message: TeamHubMessage,
    options?: { focusComposer?: boolean },
  ) => void;
  onMentionAuthor?: (actor: TeamHubActorRef) => void;
  onForwardMessage?: (message: TeamHubMessage) => void;
  onReply?: (message: TeamHubMessage) => void;
  onReplyWithQuote?: (reply: StagedQuoteReply) => void;
  presentations: Record<string, TeamHubMessagePresentation>;
  selectedContextMessageIds: ReadonlySet<string>;
  tenantId: string;
  workspaceAgentIds: ReadonlySet<string>;
}) {
  const t = useT();
  return (
    <section
      aria-label={t(m.linkedSourceMessage)}
      className="bg-app-surface-soft"
    >
      <div className="room-readable px-4 py-3 md:px-0">
        <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
          <p className="text-xs font-semibold text-app-muted">
            {t(m.linkedSourceMessage)}
          </p>
          <Button
            data-voice-close
            aria-label={t(m.closeLinkedSourceMessage)}
            onClick={onClose}
            size="compactIcon"
            title={t(m.closeLinkedSourceMessage)}
            tone="ghost"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
        {linkedSource.kind === "loading" ? (
          <div className="flex gap-2.5 py-3" role="status">
            <span className="sr-only">{t(m.loadingSourceMessage)}</span>
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2 w-10" />
              </div>
              <Skeleton className="mt-2.5 h-3 w-4/5" />
              <Skeleton className="mt-1.5 h-3 w-2/5" />
            </div>
          </div>
        ) : linkedSource.kind === "error" ? (
          <div
            className="flex min-h-12 items-center justify-between gap-3"
            role="alert"
          >
            <p className="text-sm text-app-muted">
              {t(m.sourceMessageUnavailable)}
            </p>
            <Button onClick={linkedSource.retry} size="compact">
              {t(commonMessages.retry)}
            </Button>
          </div>
        ) : (
          <MessageRow
            actorDisplayNames={actorDisplayNames}
            currentActorId={currentActorId}
            documentTitles={documentTitles}
            documentMetadata={documentMetadata}
            messageFilePreview={messageFilePreview}
            message={linkedSource.message}
            onOpenUrl={onOpenUrl}
            canMentionAuthor={mentionableActorIds.has(
              linkedSource.message.author.id,
            )}
            isAuthorMember={memberActorIds.has(linkedSource.message.author.id)}
            onCardDecision={onCardDecision}
            onOpenArtifact={onOpenArtifact}
            onOpenMessageFile={onOpenMessageFile}
            onOpenProfile={onOpenProfile}
            onOpenThread={onOpenThread}
            onMentionAuthor={onMentionAuthor}
            onReply={onReply}
            onReplyWithQuote={onReplyWithQuote}
            presentation={presentations[linkedSource.message.id]}
            selectedAsContext={selectedContextMessageIds.has(
              linkedSource.message.id,
            )}
            tenantId={tenantId}
            workspaceAgentIds={workspaceAgentIds}
          />
        )}
      </div>
    </section>
  );
}
