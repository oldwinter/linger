import { documentFileName } from "./document-display-name";
import { matchesDocumentFileType } from "./document-file-types";
import type { LibraryRowDocument } from "./library-document-results";

/** The rows one Library level shows: the chosen file type, in the chosen order. */
export function visibleLibraryDocuments(
  documents: readonly LibraryRowDocument[],
  { fileType, sortBy }: { fileType: string; sortBy: string },
): LibraryRowDocument[] {
  return documents
    .filter((document) => matchesDocumentFileType(document, fileType))
    .sort((a, b) =>
      sortBy === "name"
        ? documentFileName(a).localeCompare(documentFileName(b))
        : b.updated_at.localeCompare(a.updated_at),
    );
}
