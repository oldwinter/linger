import { formatDateTime } from "@/lib/date-format";
import type { CommentBody, CommentData } from "@blocknote/core/comments";
import { Delete02Icon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { formatLocale, translate } from "@/i18n/language";
import { useT, useTranslation } from "@/i18n/use-translation";
import { MessageMarkdown } from "../chat/message-markdown";
import { ActorAvatar } from "../members/actor-avatar";

import {
  commentBodyFromComposition,
  commentCompositionFromBody,
} from "./room-document-comment-body";
import type { TeamHubDocumentThreadStore } from "./room-document-comments";
import { DocumentMentionMessageComposer } from "./room-document-comment-composer";
import { documentCommentsMessages as m } from "./document-comments.messages";

export function RoomDocumentCommentRow({
  actors,
  comment,
  mentionOptions,
  threadId,
  threadStore,
}: {
  actors: Map<string, TeamHubActorRef>;
  comment: CommentData;
  mentionOptions: TeamHubActorRef[];
  threadId: string;
  threadStore: TeamHubDocumentThreadStore;
}) {
  const { language, t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const author = (comment.metadata as { author?: TeamHubActorRef } | undefined)
    ?.author;
  const actor = author ?? actors.get(comment.userId);
  const authorName = actor?.display_name || t(m.unknownAuthor);
  const composition = comment.body
    ? commentCompositionFromBody(comment.body, [
        ...actors.values(),
        ...mentionOptions,
      ])
    : undefined;

  async function save(body: CommentBody) {
    await threadStore.updateComment({
      comment: { body },
      commentId: comment.id,
      threadId,
    });
    setEditing(false);
  }

  return (
    <div className="room-document-comment-row">
      <ActorAvatar
        actorId={comment.userId}
        kind={actor?.kind ?? "human"}
        name={authorName}
        size="nav"
      />
      <div className="room-document-comment-content">
        <div className="room-document-comment-meta">
          <strong title={authorName}>{authorName}</strong>
          <time dateTime={comment.createdAt.toISOString()}>
            {formatDateTime(
              comment.createdAt,
              { day: "numeric", month: "short" },
              formatLocale(language),
            )}
          </time>
        </div>
        {editing && composition ? (
          <div className="room-document-comment-edit">
            <DocumentMentionMessageComposer
              ariaLabel={t(m.editCommentBy, { name: authorName })}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the field is focused on purpose because the user just opened this dialog or inline editor
              autoFocus
              initialMentions={composition.mentions}
              initialValue={composition.body}
              mentionOptions={mentionOptions}
              onCancel={() => setEditing(false)}
              onSubmit={(next) => save(commentBodyFromComposition(next))}
              placeholder={t(m.editComment)}
              submitLabel={t(m.confirm)}
            />
          </div>
        ) : (
          <div className="room-document-comment-body">
            <MessageMarkdown
              authorKind={actor?.kind ?? "human"}
              body={composition?.body ?? ""}
              mentions={composition?.mentions}
            />
          </div>
        )}
      </div>
      {!editing ? (
        <CommentActions
          comment={comment}
          onEdit={() => setEditing(true)}
          threadId={threadId}
          threadStore={threadStore}
        />
      ) : null}
    </div>
  );
}

function CommentActions({
  comment,
  onEdit,
  threadId,
  threadStore,
}: {
  comment: CommentData;
  onEdit: () => void;
  threadId: string;
  threadStore: TeamHubDocumentThreadStore;
}) {
  const t = useT();
  const [error, setError] = useState<string>();

  async function remove() {
    setError(undefined);
    try {
      await threadStore.deleteComment({ commentId: comment.id, threadId });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : translate(m.actionFailed),
      );
    }
  }

  return (
    <>
      <div className="room-document-comment-actions">
        {threadStore.auth.canUpdateComment(comment) ? (
          <Button
            aria-label={t(m.editComment)}
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            size="compactIcon"
            title={t(commonMessages.edit)}
            tone="ghost"
          >
            <Icon icon={PencilEdit01Icon} size={14} />
          </Button>
        ) : null}
        {threadStore.auth.canDeleteComment(comment) ? (
          <Button
            aria-label={t(m.deleteComment)}
            data-voice-risk="never"
            onClick={() => void remove()}
            size="compactIcon"
            title={t(commonMessages.delete)}
            tone="ghost"
          >
            <Icon icon={Delete02Icon} size={14} />
          </Button>
        ) : null}
      </div>
      {error ? (
        <span className="col-span-full text-xs text-app-danger" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
