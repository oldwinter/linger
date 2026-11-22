import { defineMessages } from "@/i18n/messages";

/** The File preview surface and its renderers. */
export const filePreviewMessages = defineMessages("filePreview", {
  // The surface.
  noPublishedVersion: "This File has no published Version.",
  previewLoadFailed: "File preview could not be loaded.",
  downloadFailed: "File download failed.",
  loadingPreview: "Loading preview...",
  previewUnavailable: "Preview is unavailable.",
  openDocument: "Open document",
  downloadFile: "Download {name}",
  download: "Download",
  downloading: "Downloading...",
  exitFullScreen: "Exit full screen",
  openFullScreen: "Open full screen",
  fullScreen: "Full screen",
  closeFilePreview: "Close file preview",
  retryPreview: "Retry preview {name}",
  versionDetails: "Version {version} · {size} · {mediaType}",
  previewExpired: "Preview expired. Refresh to load linked resources.",
  refreshPreview: "Refresh preview",
  downloadOriginal: "Download original",

  // Renderers.
  readOnlyMarkdown: "Read-only Markdown document",
  loadingRenderer: "Loading renderer...",
  officeContentUnavailable:
    "This Office preview could not start because its content was unavailable.",
  pdfContentUnavailable:
    "This PDF preview could not start because its content was unavailable.",
  tableContentUnavailable:
    "This table preview could not start because its content was unavailable.",
  mediaContentUnavailable:
    "This media preview could not start because its content was unavailable.",
  previewFile: "Preview {name}",
  zoomImageOut: "Zoom image out",
  resetImageZoom: "Reset image zoom",
  zoomImageIn: "Zoom image in",
  mermaidRenderFailed: "Mermaid could not render this diagram.",
  diagramPreviewFailed: "Diagram preview failed",
  renderingMermaid: "Rendering Mermaid diagram",
  renderingDiagram: "Rendering diagram...",
  previewContentUnavailable: "Preview content is unavailable.",

  // Data.
  loadingDataPreview: "Loading data preview...",
  parsingDataPreview: "Parsing data preview...",
  dataParseFailed: "Data preview could not be parsed.",
  dataTimedOut: "Data preview took too long and was stopped.",
  dataFailedNearRow: "Data preview failed near row {row}: {detail}",
  dataCellTooLarge: "A cell exceeds the {kibibytes} KiB basic preview limit.",
  dataFirstRecordTooLarge:
    "The first data record exceeds the {mebibytes} MiB basic preview limit.",
  dataPreviewLabel: "Data preview {name}",
  dataRows: { one: "{count} row", other: "{count} rows" },
  dataColumns: { one: "{count} column", other: "{count} columns" },
  dataTruncated: "Preview is truncated.",
  dataOnlyFirstBytes: "Only the first {mebibytes} MiB of this file is shown.",
  dataOnlyFirstRows: {
    one: "Only the first {count} row is shown.",
    other: "Only the first {count} rows are shown.",
  },
  dataOnlyFirstColumns: {
    one: "Only the first {count} column is shown.",
    other: "Only the first {count} columns are shown.",
  },
  dataOnlyFirstCells: {
    one: "Only the first {count} cell is shown.",
    other: "Only the first {count} cells are shown.",
  },

  // Audio and video.
  loadingMediaPlayer: "Loading media player...",
  mediaCodecUnsupported:
    "This browser cannot play the file's media codec. Download the original file instead.",
  audioPreview: "Audio preview {name}",
  videoPreview: "Video preview {name}",
  audio: "Audio",
  audioWithDuration: "Audio · {duration}",
  audioWaveform: "Audio waveform",
  audioPosition: "Audio position",
  pause: "Pause",
  play: "Play",
  playbackFailed: "Playback could not start. Please try again.",

  // PDF.
  loadingPdfPreview: "Loading PDF preview...",
  pdfTooManyPages:
    "This PDF has more than {max} pages and exceeds the basic preview limit.",
  pdfPreviewFailedDetail: "PDF preview failed: {detail}",
  pdfPreviewFailed: "PDF preview failed for this file.",
  pdfPageFailedDetail: "PDF page rendering failed: {detail}",
  pdfPageFailed: "PDF page rendering failed.",
  canvasUnavailable: "Canvas rendering is unavailable.",
  pdfPreview: "PDF preview {name}",
  previousPdfPage: "Previous PDF page",
  nextPdfPage: "Next PDF page",
  zoomPdfOut: "Zoom PDF out",
  zoomPdfIn: "Zoom PDF in",
  pdfPageOfTotal: "{page} / {total}",
  pdfLoading: "Loading",
  pdfPage: "PDF page {page}",
  renderingPdf: "Rendering PDF...",

  // Office.
  loadingOfficePreview: "Loading Office preview...",
  officeSandboxDidNotStart:
    "The basic Office preview sandbox did not start. Reload the page to retry.",
  basicPreview: "Basic preview {name}",
  preparingBasicPreview: "Preparing basic preview",
  officeEncrypted:
    "This Office file is encrypted and cannot be shown in basic preview.",
  officeInvalidContainer:
    "This Office file is damaged or has an invalid document structure.",
  officeInvalidFile: "This Office file could not be read for basic preview.",
  officeLimitExceeded:
    "This Office file exceeds the safe basic preview limits.",
  officeRenderFailed: "Basic Office preview failed for this file.",
  officeTimedOut: "Basic Office preview took too long and was stopped.",
  officeUnsupported: "This Office format is not supported for basic preview.",
  officeFileTooLarge:
    "The file is larger than the {mebibytes} MiB basic preview limit.",
  officeTooManySheets: "The workbook has more than {max} sheets.",
  officeSheetTooLarge:
    'Sheet "{sheet}" exceeds the basic preview row or column limit.',
  officeTooManyCells:
    "The workbook exceeds the {max}-cell basic preview limit.",
  officeTooManyEntries: "The Office package contains too many entries.",
  officeUnsafeCompression:
    "The Office package has an unsafe compression ratio.",
  officeEntryTooLarge:
    "An Office package entry is too large to preview safely.",
  officeExpandedTooLarge:
    "The expanded Office package is too large to preview safely.",
  officeTooManySlides: "The presentation has more than {max} slides.",
});
