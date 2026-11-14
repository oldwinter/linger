import {
  messageLocalTime,
  messageQuoteAuthor,
} from "@/features/rooms/chat/message-quote";

/** One comment as the clipboard text names it. */
export interface WorkItemCommentForMarkdown {
  /** Absent when nobody knows who wrote it. */
  authorName?: string | null;
  body: string;
  createdAt: string;
}

/**
 * A Work Item's discussion as a handoff note: its title, then each comment
 * behind a bold author line with the local time. A comment with no body keeps
 * its author line, so the note records that it happened rather than nothing.
 */
export function workItemCommentsMarkdown({
  comments,
  title,
}: {
  /** Already in the order the peek reads them. */
  comments: readonly WorkItemCommentForMarkdown[];
  title: string;
}): string {
  return [
    `# ${title.trim()}`,
    ...comments.map((comment) => {
      const head = `**${messageQuoteAuthor(comment.authorName)}** · ${messageLocalTime(comment.createdAt)}`;
      const body = comment.body.trim();
      return body ? `${head}\n\n${body}` : head;
    }),
  ].join("\n\n");
}
