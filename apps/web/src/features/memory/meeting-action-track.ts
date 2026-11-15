/** The block a Track click adds: the action, its meeting, and the link. */
export function meetingActionBlock(input: {
  action: string;
  meetingLink: string;
  meetingTitle: string;
}) {
  return `Track this action: ${input.action}\nFrom the meeting "${input.meetingTitle}": ${input.meetingLink}`;
}

/**
 * Stages the action once. A draft that already contains that same block is
 * left unchanged, so a second Track does not ask Another Me twice.
 */
export function draftWithTrackedAction(body: string, block: string) {
  const existing = body.trim();
  if (!existing) return block;
  const alreadyAsked = existing
    .split(/\n{2,}/u)
    .some((part) => part.trim() === block);
  return alreadyAsked ? existing : `${existing}\n\n${block}`;
}
