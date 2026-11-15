import { documentLogicalTitle } from "@/features/library/document-display-name";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

export interface RoomDocumentShare {
  /** The Document's title and absolute link, never its content. */
  text: string;
  /** Changes when the Document itself changes. */
  version: string;
}

type ShareableRoomDocument = Pick<
  TeamHubDocument,
  | "draft_capability"
  | "format"
  | "id"
  | "representation_format"
  | "title"
  | "updated_at"
>;

/**
 * Reads a Document as the Room Message the header sends: its title and its
 * absolute link. The content stays in the Document, the single source of it.
 */
export function roomDocumentShare({
  document,
  url,
}: {
  document: ShareableRoomDocument;
  url: string;
}): RoomDocumentShare {
  return {
    text: [`# ${documentLogicalTitle(document)}`, url].join("\n\n"),
    version: sanitized(`${document.id}:${document.updated_at}`),
  };
}

/** One Room Message per Document revision and Room: retrying the same send
 * replays the first Message, while another Room gets its own key. */
export function roomDocumentShareIdempotencyKey(
  version: string,
  roomId: string,
) {
  return sanitized(`document-share:${version}:${roomId}`).slice(0, 128);
}

function sanitized(part: string) {
  return part.replace(/[^A-Za-z0-9._:-]/gu, "-");
}
