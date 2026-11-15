import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** How recently the other person must have moved to count as writing. */
export const SHARED_WORD_MS = 2_000;

/**
 * Where to place the next character so it does not land inside a word the
 * other person is writing. Undefined when this caret is already outside that
 * word.
 */
export function caretOutsideSharedWord(
  text: string,
  caret: number,
  otherCarets: readonly number[],
): number | undefined {
  const word = wordBounds(text, caret);
  if (!word || caret <= word.start || caret >= word.end) return;
  const shared = otherCarets.some(
    (other) => other >= word.start && other <= word.end,
  );
  if (!shared) return;
  return word.end;
}

/** Actors whose cursor moved within the writing window. */
export function liveActorIds(
  movedAt: ReadonlyMap<string, number>,
  now: number,
): ReadonlySet<string> {
  const live = new Set<string>();
  for (const [actorId, at] of movedAt) {
    if (now - at <= SHARED_WORD_MS) live.add(actorId);
  }
  return live;
}

function wordBounds(
  text: string,
  caret: number,
): { end: number; start: number } | undefined {
  if (caret < 0 || caret > text.length) return;
  const onCharacter = caret < text.length && !isSpace(text[caret]!);
  const afterCharacter = caret > 0 && !isSpace(text[caret - 1]!);
  if (!onCharacter && !afterCharacter) return;
  let start = caret;
  while (start > 0 && !isSpace(text[start - 1]!)) start -= 1;
  let end = Math.min(caret, text.length);
  while (end < text.length && !isSpace(text[end]!)) end += 1;
  if (start === end) return;
  return { end, start };
}

function isSpace(character: string) {
  return /\s/u.test(character);
}

export interface PassageAwareness {
  clientID: number;
  getStates(): Map<number, { cursor?: unknown; user?: { actorId?: string } }>;
  off(event: "change", listener: () => void): void;
  on(event: "change", listener: () => void): void;
}

/**
 * While someone else is writing a word, a character typed into that word
 * lands after it. The editor still owns every other key.
 */
export function bindSharedPassage(
  getView: () => EditorView | null | undefined,
  awareness: PassageAwareness | null | undefined,
) {
  if (!awareness) return () => undefined;
  const cursorKeys = new Map<number, string>();
  const movedAt = new Map<string, number>();
  const remember = () => {
    const now = Date.now();
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const actorId = state.user?.actorId;
      const key = JSON.stringify(state.cursor ?? null);
      const previous = cursorKeys.get(clientId);
      cursorKeys.set(clientId, key);
      if (previous === undefined || previous === key || !actorId) continue;
      movedAt.set(actorId, now);
    }
  };
  remember();
  const onAwareness = () => remember();
  awareness.on("change", onAwareness);

  const relocate = (view: EditorView) => {
    const selection = view.state.selection;
    if (!selection.empty) return;
    const $pos = view.state.doc.resolve(selection.from);
    if (!$pos.parent.isTextblock) return;
    const text = $pos.parent.textBetween(
      0,
      $pos.parent.content.size,
      "\n",
      "\n",
    );
    const here = view.domAtPos(selection.from);
    const node =
      here.node instanceof Element ? here.node : here.node.parentElement;
    const block = node?.closest(".bn-block-outer");
    if (!block) return;
    const live = liveActorIds(movedAt, Date.now());
    const others: number[] = [];
    for (const cursor of block.querySelectorAll<HTMLElement>(
      ".bn-collaboration-cursor__base[data-actor-id]",
    )) {
      const actorId = cursor.dataset.actorId;
      if (!actorId || !live.has(actorId)) continue;
      let pos: number;
      try {
        pos = view.posAtDOM(cursor, 0);
      } catch {
        continue;
      }
      const $other = view.state.doc.resolve(
        Math.min(pos, view.state.doc.content.size),
      );
      if ($other.parent !== $pos.parent) continue;
      others.push($other.parentOffset);
    }
    const next = caretOutsideSharedWord(text, $pos.parentOffset, others);
    if (next === undefined) return;
    return $pos.start() + next;
  };

  const onBeforeInput = (event: Event) => {
    if (!(event instanceof InputEvent) || event.inputType !== "insertText") {
      return;
    }
    if (!event.data) return;
    const view = getView();
    if (!view) return;
    const at = relocate(view);
    if (at === undefined) return;
    event.preventDefault();
    view.dispatch(view.state.tr.insertText(event.data, at));
  };
  const onCompositionStart = () => {
    const view = getView();
    if (!view) return;
    const at = relocate(view);
    if (at === undefined) return;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
    );
  };

  const attach = () => {
    const view = getView();
    if (!view) return false;
    view.dom.addEventListener("beforeinput", onBeforeInput);
    view.dom.addEventListener("compositionstart", onCompositionStart);
    return true;
  };
  let attached = attach();
  const retry = window.setTimeout(() => {
    if (!attached) attached = attach();
  }, 0);

  return () => {
    window.clearTimeout(retry);
    awareness.off("change", onAwareness);
    const view = getView();
    view?.dom.removeEventListener("beforeinput", onBeforeInput);
    view?.dom.removeEventListener("compositionstart", onCompositionStart);
  };
}
