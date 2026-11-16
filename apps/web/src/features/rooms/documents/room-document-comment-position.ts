import type { Node } from "@tiptap/pm/model";

import type { RoomDocumentCommentAnchor } from "./room-document-comments";

/** Presentation fallback while the authoritative comment mark is syncing. */
export function resolveCommentAnchorPosition(
  doc: Node | undefined,
  anchor: RoomDocumentCommentAnchor | undefined | null,
): { from: number; to: number } | undefined {
  if (!doc || !anchor?.block_id || !anchor.quoted_text) return;
  let result: { from: number; to: number } | undefined;
  doc.descendants((block, blockPos) => {
    if (block.attrs.id !== anchor.block_id) return;
    let text = "";
    const positions: number[] = [];
    block.descendants((node, offset) => {
      // Nested child blocks have their own anchors.
      if (node.type.name === "blockGroup") return false;
      const value = node.isText
        ? node.text!
        : node.type.name === "hardBreak"
          ? "\n"
          : "";
      for (let index = 0; index < value.length; index += 1) {
        positions.push(blockPos + 1 + offset + index);
      }
      text += value;
    });
    const matches: number[] = [];
    for (
      let index = text.indexOf(anchor.quoted_text);
      index >= 0;
      index = text.indexOf(anchor.quoted_text, index + 1)
    ) {
      matches.push(index);
    }
    const candidates =
      matches.length > 1
        ? matches.filter((index) => {
            const before = text.slice(0, index);
            const after = text.slice(index + anchor.quoted_text.length);
            const contextBefore = anchor.context_before ?? "";
            const contextAfter = anchor.context_after ?? "";
            return (
              (contextBefore.endsWith(before) ||
                before.endsWith(contextBefore)) &&
              (contextAfter.startsWith(after) || after.startsWith(contextAfter))
            );
          })
        : matches;
    if (candidates.length === 1) {
      const index = candidates[0]!;
      result = {
        from: positions[index]!,
        to: positions[index + anchor.quoted_text.length - 1]! + 1,
      };
    } else {
      const edited = editedQuoteSpan(
        text,
        anchor.context_before ?? "",
        anchor.context_after ?? "",
      );
      if (
        edited &&
        positions[edited.start] !== undefined &&
        positions[edited.end - 1] !== undefined
      ) {
        result = {
          from: positions[edited.start]!,
          to: positions[edited.end - 1]! + 1,
        };
      }
    }
    return false;
  });
  return result;
}

/**
 * When the quoted words were rewritten, the text between the surrounding
 * words is the passage now. A missing or repeated surround stays unresolved,
 * and a passage that was removed stays a deleted reference.
 */
function editedQuoteSpan(
  text: string,
  before: string,
  after: string,
): { end: number; start: number } | undefined {
  const markerBefore = before.slice(-24);
  const markerAfter = after.slice(0, 24);
  if (markerBefore.length < 4 || markerAfter.length < 4) return;
  const startAt = text.indexOf(markerBefore);
  if (startAt < 0 || text.indexOf(markerBefore, startAt + 1) >= 0) return;
  const start = startAt + markerBefore.length;
  const endAt = text.indexOf(markerAfter, start);
  if (endAt < 0 || text.indexOf(markerAfter, endAt + 1) >= 0) return;
  if (text.slice(start, endAt).trim() === "") return;
  return { end: endAt, start };
}
