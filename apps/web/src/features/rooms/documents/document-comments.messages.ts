import { defineMessages } from "@/i18n/messages";

/**
 * Document comments: the comments panel beside a Document, its threads,
 * rows and composers. Comment text, quoted Document text and author names
 * are data and are shown as they arrive.
 */
export const documentCommentsMessages = defineMessages("documentComments", {
  allComments: "All Document comments",
  comments: "Comments",
  closeComments: "Close comments",
  loadingComments: "Loading comments...",
  loadFailed: "Comments could not be loaded.",
  noComments: "No comments",
  addComment: "Add comment",
  newComment: "New Document comment",
  addCommentPlaceholder: "Add comment...",
  addFailed: "Comment could not be added.",
  adding: "Adding...",
  commentBy: "Comment by {name}",
  commentDeleted: "Comment deleted",
  sendReply: "Send reply",
  replyToComment: "Reply to Document comment",
  reply: "Reply",
  // {count} is the number of comment threads in the Document.
  showAllComments: "Show all Document comments ({count})",
  selectedText: "Selected text",
  noResolvedComments: "No resolved comments",
  noOpenComments: "No open comments",
  selectTextHint: "Select text in the document, then choose Add comment.",
  deletedReference: "Deleted reference",
  // {reference} is the Document text the comment is attached to.
  commentOn: "Comment on {reference}",
  linkFailed: "Comment saved, but it couldn't be linked to the selected text.",
  retrying: "Retrying...",
  retryLinking: "Retry linking",
  unknownAuthor: "Unknown author",
  actionFailed: "Comment action failed",
  editCommentBy: "Edit comment by {name}",
  editComment: "Edit comment",
  confirm: "Confirm",
  deleteComment: "Delete comment",
  addCommentPlaceholderShort: "Add a comment",
  replyPlaceholder: "Reply...",
  mentionDirectoryUnavailable: "Mention directory is unavailable.",
  agentReplying: "{name} is replying",
  // {names} is a list of Agent names joined with listSeparator; {last} is
  // the last Agent.
  agentsReplying: "{names} and {last} are replying",
  // Joins names in a list.
  listSeparator: ", ",
  addCommentToSelection: "Add comment to selected text",
  saveBeforeCommenting: "Save the Document before creating or editing Comments",
  newSelectionComment: "New selection comment",
});
