import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

/** The file the page-list view saves every page under. */
export const POCKET_NOTES_FILENAME = "pocket-notes.md";

const EXPORT_TITLE = "# Pocket Notes";

/**
 * The one file holding every page: a title line, then each page under its own
 * date heading, in the order the list shows them. A page with nothing written
 * on it has no heading.
 */
export function pocketNotesMarkdown(
  notes: readonly TeamHubPocketNote[],
): string {
  const sections = notes.flatMap((note) => {
    const text = note.text.trim();
    return text ? [`## ${note.date}\n\n${text}`] : [];
  });
  return [EXPORT_TITLE, ...sections].join("\n\n");
}
