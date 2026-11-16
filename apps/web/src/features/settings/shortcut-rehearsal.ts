import {
  keyboardShortcutGroups,
  type KeyboardShortcut,
  type KeyboardShortcutGroup,
} from "./keyboard-shortcuts";

/** What a pressed shortcut does, in the place where those keys work. */
export interface PlayedShortcut {
  action: string;
  chord: string;
  where: string;
}

interface Chord {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

/**
 * Every catalog shortcut the key event would fire, in catalog order. A press
 * inside a field is not a rehearsal; the caller leaves those keys to the field.
 */
export function playedShortcuts(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
  groups: readonly KeyboardShortcutGroup[] = keyboardShortcutGroups,
): PlayedShortcut[] {
  const played: PlayedShortcut[] = [];
  for (const group of groups) {
    for (const shortcut of group.shortcuts) {
      const chord = matchingChord(event, shortcut);
      if (!chord) continue;
      played.push({
        action: shortcut.action,
        chord,
        where: group.description,
      });
    }
  }
  return played;
}

function matchingChord(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
  shortcut: KeyboardShortcut,
): string | undefined {
  const labels = [shortcut.keys.mac, shortcut.keys.other].filter(
    (label): label is string => Boolean(label),
  );
  for (const label of labels) {
    for (const alternative of label.split(/\s+\/\s+|\s+or\s+/u)) {
      const chord = readChord(alternative);
      if (chord && sameChord(chord, event)) return alternative.trim();
    }
  }
  return undefined;
}

function readChord(label: string): Chord | undefined {
  let alt = false;
  let ctrl = false;
  let meta = false;
  let shift = false;
  let key = "";
  for (const token of label.trim().split(/\s*\+\s*|\s+/u)) {
    if (!token) continue;
    if (/^ctrl$/iu.test(token)) {
      ctrl = true;
      continue;
    }
    if (/^alt$/iu.test(token)) {
      alt = true;
      continue;
    }
    if (/^shift$/iu.test(token)) {
      shift = true;
      continue;
    }
    let rest = token;
    while (rest.length > 0) {
      const symbol = rest[0];
      if (symbol === "⌘") {
        meta = true;
        rest = rest.slice(1);
        continue;
      }
      if (symbol === "⌥") {
        alt = true;
        rest = rest.slice(1);
        continue;
      }
      if (symbol === "⇧") {
        shift = true;
        rest = rest.slice(1);
        continue;
      }
      if (symbol === "↑") {
        key = "arrowup";
        rest = rest.slice(1);
        continue;
      }
      if (symbol === "↓") {
        key = "arrowdown";
        rest = rest.slice(1);
        continue;
      }
      if (symbol === "←") {
        key = "arrowleft";
        rest = rest.slice(1);
        continue;
      }
      if (symbol === "→") {
        key = "arrowright";
        rest = rest.slice(1);
        continue;
      }
      key = rest.toLowerCase();
      rest = "";
    }
  }
  if (!key) return undefined;
  return { alt, ctrl, key, meta, shift };
}

function sameChord(
  chord: Chord,
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): boolean {
  return (
    chord.alt === event.altKey &&
    chord.ctrl === event.ctrlKey &&
    chord.meta === event.metaKey &&
    chord.shift === event.shiftKey &&
    chord.key === eventKey(event.key)
  );
}

function eventKey(key: string) {
  if (key === " ") return "space";
  return key.toLowerCase();
}
