import type { TeamHubPocketNote } from "@/features/teamhub/teamhub-types";

/**
 * The newest written page before today. An empty page and a later date are
 * not the day the paper continues into.
 */
export function pocketNoteBefore(
  notes: readonly TeamHubPocketNote[],
  today: string,
): TeamHubPocketNote | undefined {
  return notes.find((note) => note.date < today && note.text.trim());
}
