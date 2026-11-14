import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

import { documentFileName } from "./document-display-name";

type LibraryLinkDocument = Pick<
  TeamHubDocument,
  "format" | "representation_format" | "title"
> & { id: string };

/**
 * A Markdown list of the given Documents, in the order received. Each bullet
 * pairs the name the list shows with an absolute link; a Document whose link
 * cannot be built is left out rather than writing a broken link into whatever
 * the person pastes it into.
 */
export function selectedDocumentsMarkdown({
  documents,
  origin,
  tenantId,
}: {
  documents: readonly LibraryLinkDocument[];
  origin: string;
  tenantId: string;
}): string {
  return documents
    .flatMap((document) => {
      const url = documentLinkUrl(origin, tenantId, document);
      if (!url) return [];
      return [`- [${escapeLinkText(documentFileName(document))}](${url})`];
    })
    .join("\n");
}

function documentLinkUrl(
  origin: string,
  tenantId: string,
  document: LibraryLinkDocument,
) {
  if (!document.id.trim()) return undefined;
  try {
    return new URL(
      documentDetailPath({ documentId: document.id, tenantId }),
      origin,
    ).toString();
  } catch {
    return undefined;
  }
}

/** A bracket in a name would end the link text early and break the bullet. */
function escapeLinkText(value: string) {
  return value.replace(/[[\]\\]/gu, (character) => `\\${character}`);
}
