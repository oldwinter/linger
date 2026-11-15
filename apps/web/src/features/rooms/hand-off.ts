export interface HandOffPerson {
  display_name: string;
  id: string;
  kind: "agent" | "human";
}

export function handOffPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/hand-off`;
}

/** Agents come first: they are the ones who can pick the job up next. */
export function handOffCandidates<T extends HandOffPerson>(
  people: readonly T[],
  selfActorId: string | undefined,
): T[] {
  return people
    .filter((person) => person.id !== selfActorId)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "agent" ? -1 : 1;
      return left.display_name.localeCompare(right.display_name);
    });
}
