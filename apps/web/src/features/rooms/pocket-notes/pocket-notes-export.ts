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
    const section = pocketNoteSection(note);
    return section ? [section] : [];
  });
  return [EXPORT_TITLE, ...sections].join("\n\n");
}

/**
 * How one page appears inside the export: its date heading and text. A page
 * with nothing written on it has no section.
 */
function pocketNoteSection(note: TeamHubPocketNote): string | null {
  const text = note.text.trim();
  return text ? `## ${note.date}\n\n${text}` : null;
}

/** The file one page downloads: the same section the export writes for it. */
export function pocketNoteMarkdown(note: TeamHubPocketNote): string {
  return pocketNoteSection(note) ?? "";
}

/** The file name for one page, named for its day and safe on any filesystem. */
export function pocketNoteFilename(date: string): string {
  return `pocket-note-${fileSafe(date)}.md`;
}

function fileSafe(date: string): string {
  const safe = date
    .replace(/[^0-9A-Za-z._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return safe || "undated";
}
