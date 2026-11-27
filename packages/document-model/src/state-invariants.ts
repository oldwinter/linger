import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const ROOM_DOCUMENT_SCHEMA_VERSION = 1;
export const ROOM_DOCUMENT_STATE_HASH_VERSION = 1;
export const ROOM_DOCUMENT_MAX_SOURCE_BYTES = 32 << 20;
export const ROOM_DOCUMENT_MAX_STATE_BYTES = 32 << 20;
export const ROOM_DOCUMENT_MAX_BLOCKS = 10_000;
export const ROOM_DOCUMENT_MAX_BLOCK_DEPTH = 64;
export const ROOM_DOCUMENT_MAX_INLINE_SEGMENTS = 100_000;
export const ROOM_DOCUMENT_MAX_TEXT_BYTES = 16 << 20;
export const ROOM_DOCUMENT_MAX_REFERENCES = 4_096;
export const ROOM_DOCUMENT_COMMENT_MARK_PATTERN =
  /^comment(?:--[A-Za-z0-9+/=]{8})?$/;
export const ROOM_DOCUMENT_MEDIA_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "file",
  "image",
  "video",
  "audio",
]);

/** Collaboration session limits of the Document Runtime, the only copy. */
export const ROOM_DOCUMENT_SESSION_LIMITS = Object.freeze({
  yjs_frame_bytes: (16 << 20) + 1024,
  state_bundle_decoded_bytes: 16 << 20,
  mutations_per_batch: 2_048,
});

export class RoomDocumentModelError extends Error {
  constructor(
    readonly code:
      | "payload_too_large"
      | "unsupported_document"
      | "validation_failed",
    message: string,
  ) {
    super(message);
    this.name = "RoomDocumentModelError";
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}
