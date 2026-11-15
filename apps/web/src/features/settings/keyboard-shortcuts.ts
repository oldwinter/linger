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
];
