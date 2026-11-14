import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";

export interface FindablePocketNote {
  date: string;
  text: string;
  label: string;
}

/** Loaded Pocket Notes whose day, label, or words contain the query. */
export function pocketNotesMatching<T extends FindablePocketNote>(
  notes: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...notes];
  return notes.filter((note) =>
    [note.label, note.date, markdownPlainText(note.text)]
      .join("\n")
      .toLowerCase()
      .includes(needle),
  );
}
