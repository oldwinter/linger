export interface NamedActor {
  id: string;
  name: string;
}

/** Assignees whose actor is not a member of the room doing the work. */
export function assigneesMissingFromRoom(
  assignees: readonly NamedActor[],
  memberIds: ReadonlySet<string>,
): NamedActor[] {
  const missing: NamedActor[] = [];
  const seen = new Set<string>();
  for (const assignee of assignees) {
    if (memberIds.has(assignee.id) || seen.has(assignee.id)) continue;
    seen.add(assignee.id);
    missing.push(assignee);
  }
  return missing;
}

export function assigneesMissingFromRoomText(names: readonly string[]) {
  if (names.length === 0) return;
  if (names.length === 1) {
    return `${names[0]} is assigned and is not in the room doing this work.`;
  }
  const listed =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
  return `${listed} are assigned and are not in the room doing this work.`;
}
