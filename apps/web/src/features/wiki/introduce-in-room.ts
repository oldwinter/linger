/** The message Another Me would leave in a Room to introduce you. */
export function introductionMessage(paragraphs: readonly string[]): string {
  return ["How Another Me would introduce you", "", ...paragraphs].join("\n");
}

/**
 * Stable for one introduction and one Room, so a refused send can be retried
 * as the same message. A different introduction is a different message.
 */
export function introductionIdempotencyKey(
  roomId: string,
  text: string,
): string {
  let hash = 0;
  for (const char of text)
    hash = (Math.imul(hash, 33) + char.charCodeAt(0)) >>> 0;
  return `introduce:${roomId}:${hash.toString(16)}`.slice(0, 128);
}
