import { artifactFileKind } from "@/features/rooms/files/artifact-file-kind";
import {
  documentFileName,
  documentRepresentationFormat,
} from "./document-display-name";
import type { TeamHubDocumentTreeSummary } from "@/features/teamhub/teamhub-types";

import { libraryMessages as m } from "./library.messages";

/** Each type's label is a message, worded when the filter shows it. */
export const documentFileTypes = [
  { value: "", label: m.typeAll },
  { value: "md", label: m.typeMarkdown },
  { value: "pdf", label: m.typePdf },
  { value: "word", label: m.typeWord },
  { value: "spreadsheet", label: m.typeSpreadsheet },
  { value: "presentation", label: m.typePresentation },
  { value: "html", label: m.typeHtml },
  { value: "text", label: m.typeText },
  { value: "image", label: m.typeImage },
  { value: "audio", label: m.typeAudio },
  { value: "video", label: m.typeVideo },
  { value: "archive", label: m.typeArchive },
  { value: "code", label: m.typeCode },
  { value: "others", label: m.typeOthers },
] as const;

export function documentFileType(
  document: Pick<
    TeamHubDocumentTreeSummary,
    "format" | "representation_format" | "title"
  >,
): string {
  const format = documentRepresentationFormat(document);
  if (format === "markdown") return "md";
  if (format === "plain_text") return "text";
  if (format === "csv") return "spreadsheet";
  const name = documentFileName(document);
  if (/\.(txt|log)$/i.test(name)) return "text";
  if (/\.(doc|docx)$/i.test(name)) return "word";
  const kind = artifactFileKind(name);
  if (kind === "markdown") return "md";
  return kind === "document" || kind === "workflow" ? "others" : kind;
}

export function matchesDocumentFileType(
  document: Pick<
    TeamHubDocumentTreeSummary,
    "format" | "representation_format" | "title"
  >,
  type: string,
) {
  return !type || documentFileType(document) === type;
}
