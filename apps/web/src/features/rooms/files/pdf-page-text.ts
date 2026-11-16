/**
 * A PDF text run can carry a null between glyphs, and a compatibility
 * character where a sentence would use an ordinary one. The pasted line
 * should read as that sentence.
 */
export function pdfPageCopyText(value: string) {
  return value.replaceAll("\0", "").normalize("NFKC");
}

export function pdfSelectionText(root: HTMLElement, selection: Selection | null) {
  if (!selection) return;
  const copied = selection.toString();
  if (copied === "") return;
  const node = selection.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentNode;
  if (!(element instanceof Node) || !root.contains(element)) return;
  return pdfPageCopyText(copied);
}
