import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import { useT } from "@/i18n/use-translation";

import { commentBodyFromComposition } from "./room-document-comment-body";
import { DocumentMentionMessageComposer } from "./room-document-comment-composer";
import type { TeamHubDocumentThreadStore } from "./room-document-comments";
import { documentCommentsMessages as m } from "./document-comments.messages";

export function RoomDocumentCommentReplyComposer({
  mentionOptions,
  threadId,
  threadStore,
}: {
  mentionOptions: TeamHubActorRef[];
  threadId: string;
  threadStore: TeamHubDocumentThreadStore;
}) {
  const t = useT();
  return (
    <div className="room-document-comment-reply">
      <DocumentMentionMessageComposer
        ariaLabel={t(m.replyToComment)}
        mentionOptions={mentionOptions}
        onSubmit={async (composition) => {
          await threadStore.addComment({
            comment: { body: commentBodyFromComposition(composition) },
            threadId,
          });
        }}
        placeholder={t(m.replyPlaceholder)}
      />
    </div>
  );
}
