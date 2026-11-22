import { defineMessages } from "@/i18n/messages";

/**
 * Why a File download or upload failed. The transfer client is part of the
 * first load, so this stays to the errors a person can meet in a preview,
 * a download or an upload.
 */
export const fileTransferMessages = defineMessages("fileTransfer", {
  integrityFailed: "The File download failed integrity verification.",
  rangeNotHonored: "The File preview server did not honor the byte range.",
  versionChanged: "The File preview no longer matches its immutable Version.",
  unexpectedRange: "The File preview returned an unexpected byte range.",
  downloadTimedOut: "File download timed out.",
  noStream: "The browser did not expose a bounded File download stream.",
  downloadTooLarge:
    "The File download exceeded the {mebibytes} MiB client limit.",
  noVersionSize: "The immutable Version has no usable byte size.",
  noRangeMetadata: "The immutable Version has no usable byte range metadata.",
  invalidContentRange: "The File preview returned an invalid Content-Range.",
  invalidContentLength: "The File download returned an invalid Content-Length.",
  sizeMismatch:
    "The downloaded bytes do not match its immutable Version metadata.",
  uploadProxyTimedOut:
    "The upload timed out before it reached TeamHub (HTTP {status}). The network upload speed is too slow for this file. Retry, or use a smaller file.",
  uploadUnreachable: "TeamHub upload could not reach the server.",
  uploadTimedOut: "TeamHub upload timed out.",
  uploadNotStarted: "TeamHub upload could not be started.",
});
