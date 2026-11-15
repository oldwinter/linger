const messageParam = "message";

/**
 * A Message's location: the Room's own path plus the Message it should open.
 * A path that already carries a query keeps it, so a search highlight and the
 * Message itself can travel in one link.
 */
export function messageLink(roomPath: string, messageId: string): string {
  const separator = roomPath.includes("?") ? "&" : "?";
  return `${roomPath}${separator}${messageParam}=${encodeURIComponent(messageId)}`;
}

/**
 * The Message id a location names, or null when it names only the Room. The
 * location may be a path, a full URL, or just its query string.
 */
export function messageLinkId(location: string): string | null {
  const query = location.indexOf("?");
  if (query < 0) return null;
  const hash = location.indexOf("#", query);
  const id = new URLSearchParams(
    location.slice(query, hash < 0 ? undefined : hash),
  ).get(messageParam);
  return id || null;
}
