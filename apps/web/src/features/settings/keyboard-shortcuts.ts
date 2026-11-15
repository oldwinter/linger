/**
 * The shortcuts this app answers to. Every entry names keys that a handler in
 * the Web client reads; add one only after that handler exists.
 */
export interface KeyboardShortcut {
  /** What pressing the keys does. */
  action: string;
  keys: {
    /** The keys on macOS, named as the app names its modifier keys. */
    mac: string;
    /** The keys elsewhere, set only when another platform differs. */
    other?: string;
  };
}

export interface KeyboardShortcutGroup {
  /** Where the group's shortcuts work. */
  description: string;
  shortcuts: readonly KeyboardShortcut[];
  title: string;
}

export const keyboardShortcutGroups: readonly KeyboardShortcutGroup[] = [
  {
    description: "Works anywhere in a Room.",
    shortcuts: [
      {
        action: "Open search",
        keys: { mac: "⌘K", other: "Ctrl K" },
      },
      {
        action: "Close the active sidebar tab, or collapse the sidebar",
        keys: { mac: "Escape" },
      },
      {
        action: "Reopen the last closed sidebar tab",
        keys: { mac: "⌘⇧T", other: "Ctrl Shift T" },
      },
      {
        action: "Switch to the previous or next sidebar tab",
        keys: { mac: "⌘⌥← / ⌘⌥→", other: "Ctrl Alt ← / Ctrl Alt →" },
      },
    ],
    title: "Global",
  },
  {
    description: "Works while the search dialog has focus.",
    shortcuts: [
      {
        action: "Move through search results",
        keys: { mac: "↑ / ↓" },
      },
      {
        action: "Open the highlighted search result",
        keys: { mac: "Enter" },
      },
      {
        action: "Narrow search to the highlighted result type",
        keys: { mac: "Tab" },
      },
      {
        action: "Return to all search scopes when the query is empty",
        keys: { mac: "Backspace" },
      },
      {
        action: "Remove the highlighted recent search when the query is empty",
        keys: { mac: "Delete" },
      },
      {
        action: "Close the search dialog",
        keys: { mac: "Escape" },
      },
    ],
    title: "Search dialog",
  },
  {
    description: "Works while the message field has focus.",
    shortcuts: [
      {
        action: "Send the message",
        keys: { mac: "Enter" },
      },
      {
        action: "Start a new line",
        keys: { mac: "Shift + Enter" },
      },
      {
        action: "Move through mention and skill suggestions",
        keys: { mac: "↑ / ↓" },
      },
      {
        action: "Insert the highlighted suggestion",
        keys: { mac: "Enter or Tab" },
      },
      {
        action: "Dismiss the suggestions",
        keys: { mac: "Escape" },
      },
    ],
    title: "Chat composer",
  },
  {
    description: "Works while the Room Document editor has focus.",
    shortcuts: [
      {
        action: "Select everything in the Document",
        keys: { mac: "⌘A", other: "Ctrl A" },
      },
      {
        action: "Continue a list in a table cell",
        keys: { mac: "Enter" },
      },
    ],
    title: "Room Document editor",
  },
  {
    description:
      "Works on the Work Items board when no input or dialog has focus.",
    shortcuts: [
      {
        action: "Select the next Work Item card",
        keys: { mac: "J or ↓" },
      },
      {
        action: "Select the previous Work Item card",
        keys: { mac: "K or ↑" },
      },
      {
        action: "Peek the selected Work Item card",
        keys: { mac: "Enter" },
      },
      {
        action: "Clear the Work Item card selection",
        keys: { mac: "Escape" },
      },
    ],
    title: "Work Items board",
  },
  {
    description: "Works in the Wiki directory.",
    shortcuts: [
      {
        action: "Focus the Wiki page filter",
        keys: { mac: "/" },
      },
      {
        action: "Clear and leave the active Wiki page filter",
        keys: { mac: "Escape" },
      },
    ],
    title: "Wiki directory",
  },
  {
    description: "Works on a Meeting detail page when a recording is ready.",
    shortcuts: [
      {
        action: "Play or pause the Meeting recording",
        keys: { mac: "Space" },
      },
      {
        action: "Seek backward or forward 5 seconds",
        keys: { mac: "← / →" },
      },
    ],
    title: "Meeting audio player",
  },
];

/**
 * Filter shortcut groups by matching group title, description, action, or key label.
 */
export function filterKeyboardShortcutGroups(
  query: string,
  groups: readonly KeyboardShortcutGroup[] = keyboardShortcutGroups,
): readonly KeyboardShortcutGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;

  const filtered: KeyboardShortcutGroup[] = [];
  for (const group of groups) {
    if (
      group.title.toLowerCase().includes(needle) ||
      group.description.toLowerCase().includes(needle)
    ) {
      filtered.push(group);
      continue;
    }
    const shortcuts = group.shortcuts.filter(
      (shortcut) =>
        shortcut.action.toLowerCase().includes(needle) ||
        shortcut.keys.mac.toLowerCase().includes(needle) ||
        (shortcut.keys.other?.toLowerCase().includes(needle) ?? false),
    );
    if (shortcuts.length > 0) {
      filtered.push({ ...group, shortcuts });
    }
  }
  return filtered;
}
