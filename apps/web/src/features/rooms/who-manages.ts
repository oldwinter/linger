export type RoomRole = "member" | "owner";

export interface ManagePerson {
  id: string;
  kind: "agent" | "human";
  role: RoomRole;
}

export function whoManagesPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/who-manages`;
}

/** Role writes, owners first so a room never briefly has no owner. */
export function roleWrites(
  people: readonly ManagePerson[],
  chosen: ReadonlyMap<string, RoomRole>,
) {
  const writes = people.flatMap((person) => {
    if (person.kind !== "human") return [];
    const next = chosen.get(person.id) ?? person.role;
    return next === person.role ? [] : [{ id: person.id, role: next }];
  });
  return [
    ...writes.filter((item) => item.role === "owner"),
    ...writes.filter((item) => item.role === "member"),
  ];
}

export function leavesNoOwner(
  people: readonly ManagePerson[],
  chosen: ReadonlyMap<string, RoomRole>,
) {
  return !people.some(
    (person) =>
      person.kind === "human" &&
      (chosen.get(person.id) ?? person.role) === "owner",
  );
}

export function chosenRole(
  person: ManagePerson,
  chosen: ReadonlyMap<string, RoomRole>,
) {
  return chosen.get(person.id) ?? person.role;
}
