import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

import { FileDropTarget } from "@/components/ui/file-drop-target";
import { WorkItemCreateDialog } from "@/features/work-items/work-item-create-dialog";
import { messageWorkItemDraft } from "@/features/work-items/work-item-create-draft";

import { MessageForwardDialog } from "./message-forward-dialog";
import { RoomReadStateSync } from "./room-read-state-sync";
import { AnotherMeIntro } from "./another-me-intro";
import { MessageVoiceSelectionControl } from "./voice-mode/message-voice-selection-control";
import { anotherMeQueryOptions } from "../room-queries";
import { AnotherMeMirrorProvider } from "./another-me-mirror";
import { useRoomChatData } from "./use-room-chat-data";
import { useRoomChatConversationState } from "./use-room-chat-conversation-state";
import { useRoomChatTimelineActions } from "./use-room-chat-timeline-actions";
import { RoomChatTimelineSection } from "./room-chat-timeline-section";
import { RoomChatComposerSection } from "./room-chat-composer-section";

const TaskConversationDialog = lazy(async () => {
  const module = await import(
    "../task-sidebar/adapters/task-conversation-dialog"
  );
  return { default: module.TaskConversationDialog };
});

export function RoomChatImpl() {
  // The sub-hooks run in this order so their effects keep the order the Room
  // chat relies on: data reads, then conversation state, then actions.
  const data = useRoomChatData();
  const state = useRoomChatConversationState(data);
  const actions = useRoomChatTimelineActions(data, state);
  const {
    client,
    createIssueMessage,
    forwardMessage,
    identity,
    room,
    roomId,
    setCreateIssueMessage,
    setForwardMessage,
    tenantId,
  } = data;
  const { currentActor, interactions, onboarding, timeline } = state;
  const anotherMe = useQuery(anotherMeQueryOptions(client, tenantId));
  const human = identity.actors.find((actor) => actor.tenant_id === tenantId);
  const mirror =
    anotherMe.data?.room_id === roomId && human
      ? { actorId: human.id, name: human.display_name }
      : undefined;
  return (
    <AnotherMeMirrorProvider value={mirror}>
      <div className="room-chat-layout flex min-h-0 flex-1">
        {onboarding.introPlaying && onboarding.agent ? (
          <AnotherMeIntro
            agent={onboarding.agent}
            humanName={currentActor?.display_name ?? ""}
            onDone={onboarding.finishIntro}
          />
        ) : null}
        {actions.arrivedTask ? (
          <Suspense fallback={null}>
            <TaskConversationDialog
              onClose={actions.clearArrivedTask}
              originRoomId={roomId}
              taskId={actions.arrivedTask.id}
              tenantId={tenantId}
              title={actions.arrivedTask.title}
            />
          </Suspense>
        ) : null}
        <FileDropTarget
          canAccept={() =>
            interactions.composerRef.current?.canAcceptFiles() ?? false
          }
          className="room-chat-column relative flex min-h-0 min-w-0 flex-1 flex-col"
          key={`${tenantId}/${roomId}`}
          onFiles={(files) => {
            interactions.composerRef.current?.addFiles(files);
          }}
          subtitle="Up to 5 files"
          testId="room-chat-file-drop-target"
          title="Release to add to the current message"
        >
          <RoomChatTimelineSection
            actions={actions}
            data={data}
            state={state}
          />
          {forwardMessage ? (
            <MessageForwardDialog
              client={client}
              message={forwardMessage}
              onClose={() => setForwardMessage(null)}
              tenantId={tenantId}
            />
          ) : null}
          {createIssueMessage ? (
            <WorkItemCreateDialog
              initial={messageWorkItemDraft({
                authorName:
                  actions.actorDisplayNames[createIssueMessage.author.id] ??
                  createIssueMessage.author.display_name,
                createdAt: createIssueMessage.created_at,
                message: createIssueMessage.raw_message,
                roomId: createIssueMessage.room_id,
              })}
              onClose={() => setCreateIssueMessage(null)}
              rooms={[{ id: room.id, kind: room.kind, name: room.name }]}
              tenantId={tenantId}
            />
          ) : null}
          <MessageVoiceSelectionControl root={timeline.timelineElement} />
          <div>
            <RoomChatComposerSection
              actions={actions}
              data={data}
              state={state}
            />
          </div>
          <RoomReadStateSync
            roomId={roomId}
            tenantId={tenantId}
            throughRoomSeq={data.lastAppliedRoomSeq}
          />
        </FileDropTarget>
      </div>
    </AnotherMeMirrorProvider>
  );
}
