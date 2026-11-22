import { BlockNoteEditor } from "@blocknote/core";
import { yDocToBlocks } from "@blocknote/core/yjs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Y from "yjs";

import { translate } from "@/i18n/language";

import { documentPageMessages as m } from "./document-page.messages";
import { roomDocumentCommentSchema } from "./room-document-comment-schema";

export function historyRevisionMarkdown(
  stateBytesBase64: string,
  expectedSHA256: string,
) {
  const stateBytes = decodeBase64(stateBytesBase64);
  if (bytesToHex(sha256(stateBytes)) !== expectedSHA256) {
    throw new Error(translate(m.revisionIntegrityFailed));
  }
  const document = new Y.Doc({ gc: true });
  document.getXmlFragment("prosemirror");
  Y.applyUpdate(document, stateBytes);
  const editor = BlockNoteEditor.create({ schema: roomDocumentCommentSchema });
  try {
    const blocks = yDocToBlocks(editor, document, "prosemirror");
    return editor.blocksToMarkdownLossy(blocks).trim();
  } finally {
    editor.unmount();
    document.destroy();
  }
}

function decodeBase64(value: string) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error(translate(m.revisionInvalid));
  }
}
