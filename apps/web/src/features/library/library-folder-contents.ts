import {
  type LibraryLinkDocument,
  selectedDocumentsMarkdown,
} from "./library-selection-links";

/**
 * One Library folder's Documents as a roster someone can paste into a report:
 * the folder's name, then one link per Document in the order the list shows.
 * A folder's subfolders are not part of this list; only its own Documents are.
 */
export function folderContentsMarkdown(input: {
  documents: readonly LibraryLinkDocument[];
  folderName: string;
  origin: string;
  tenantId: string;
}) {
  const heading = `# ${input.folderName}`;
  const links = selectedDocumentsMarkdown(input);
  return links ? `${heading}\n\n${links}` : heading;
}
