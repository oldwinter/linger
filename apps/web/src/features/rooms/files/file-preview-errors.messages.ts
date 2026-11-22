import { defineMessages } from "@/i18n/messages";

/**
 * Why a File is not previewed, or its preview did not load. Chat rows read
 * the renderer policy too, so these stay apart from the preview surface's
 * own messages in `file-preview.messages.ts`.
 */
export const filePreviewErrorMessages = defineMessages("filePreview", {
  svgTooLarge: "This file is larger than the safe SVG preview limit.",
  pdfTooLarge: "This file is larger than the safe PDF preview limit.",
  officeTooLarge:
    "This file is larger than the {mebibytes} MiB basic Office preview limit.",
  imageTooLarge: "This image is larger than the safe preview limit.",
  textTooLarge: "This text file is larger than the safe preview limit.",
  markdownTooLarge: "This file is larger than the safe Markdown preview limit.",
  mermaidTooLarge: "This file is larger than the safe Mermaid preview limit.",
  htmlTooLarge: "This file is larger than the safe HTML preview limit.",
  downloadOnly: "This format is available as a download only.",
  mediaTypeMismatch:
    "The filename and media type do not agree, so preview is disabled.",
  versionNotInDocument:
    "This Version does not belong to the selected Document.",
  noUsableMediaType: "The immutable Version has no usable media type.",
  mediaTypeChanged:
    "The downloaded media type does not match its immutable Version metadata.",
  noUsableDigest: "The immutable Version has no usable SHA-256 digest.",
  digestMismatch:
    "The downloaded SHA-256 does not match its immutable Version metadata.",
});
