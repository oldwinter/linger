import { documentFileName } from "./document-display-name";
import { matchesDocumentFileType } from "./document-file-types";
import type { LibraryRowDocument } from "./library-document-results";
import type { LibraryFolder } from "./library-folder-browser";

function queryTerms(query: string | undefined): string[] {
  return (query ?? "").trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

function matchesSearchTerms(haystack: string, terms: readonly string[]) {
  if (terms.length === 0) return true;
  const normalized = haystack.toLowerCase();
  return terms.every((term) => normalized.includes(term));
}

/** The rows one Library level shows: the chosen file type and search query, in the chosen order. */
export function visibleLibraryDocuments(
  documents: readonly LibraryRowDocument[],
  {
    fileType,
    query,
    sortBy,
  }: { fileType: string; query?: string; sortBy: string },
): LibraryRowDocument[] {
  const terms = queryTerms(query);
  return documents
    .filter((document) => {
      if (!matchesDocumentFileType(document, fileType)) return false;
      if (terms.length === 0) return true;
      const sources = (document.from ?? [])
        .map((source) => source.label ?? source.binding_kind)
        .join(" ");
      return matchesSearchTerms(
        `${documentFileName(document)} ${document.title} ${document.owner.display_name} ${sources}`,
        terms,
      );
    })
    .sort((a, b) =>
      sortBy === "name"
        ? documentFileName(a).localeCompare(documentFileName(b))
        : b.updated_at.localeCompare(a.updated_at),
    );
}

/** Folders matching the active search query, in the chosen order. */
export function visibleLibraryFolders(
  folders: readonly LibraryFolder[],
  { query, sortBy }: { query?: string; sortBy: string },
): LibraryFolder[] {
  const terms = queryTerms(query);
  return folders
    .filter((folder) => matchesSearchTerms(folder.name, terms))
    .sort((a, b) =>
      sortBy === "name"
        ? a.name.localeCompare(b.name)
        : b.updated_at.localeCompare(a.updated_at),
    );
}
