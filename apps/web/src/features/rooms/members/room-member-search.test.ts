import { describe, expect, it } from "vitest";

import { searchRoomMembers } from "./room-member-search";

function member(id: string, name: string) {
  return {
    actor: { display_name: name, id },
    role: "member" as const,
  };
}

const jenny = member("actor-1", "Jenny Bin");
const maya = member("actor-2", "Maya Chen");
const codex = member("actor-3", "Codex");
const gtm = member("actor-4", "Lev8 GTM");
const delegate = member("actor-5", "Jenny's Delegate");
const members = [jenny, maya, codex, gtm, delegate];

function ids(items: readonly ReturnType<typeof member>[]) {
  return items.map((item) => item.actor.id);
}

describe("searchRoomMembers", () => {
  it("matches a member's name", () => {
    expect(ids(searchRoomMembers(members, "maya").items)).toEqual(["actor-2"]);
    expect(searchRoomMembers(members, "maya").count).toBe(1);
  });

  it("matches case-insensitively", () => {
    expect(ids(searchRoomMembers(members, "MAYA").items)).toEqual(["actor-2"]);
  });

  it("requires every word of the query", () => {
    expect(ids(searchRoomMembers(members, "maya chen").items)).toEqual([
      "actor-2",
    ]);
    expect(ids(searchRoomMembers(members, "jenny delegate").items)).toEqual([
      "actor-5",
    ]);
    expect(searchRoomMembers(members, "maya codex").items).toEqual([]);
  });

  it("keeps the existing order of the matches", () => {
    expect(ids(searchRoomMembers(members, "n").items)).toEqual([
      "actor-1",
      "actor-2",
      "actor-5",
    ]);
  });

  it("keeps every member and counts them for an empty query", () => {
    const result = searchRoomMembers(members, "");

    expect(ids(result.items)).toEqual([
      "actor-1",
      "actor-2",
      "actor-3",
      "actor-4",
      "actor-5",
    ]);
    expect(result.count).toBe(5);
    expect(result.items[0]).toBe(jenny);
  });

  it("treats a whitespace-only query as empty", () => {
    expect(searchRoomMembers(members, "   ").count).toBe(5);
  });

  it("counts no members when nothing matches", () => {
    const result = searchRoomMembers(members, "absent name");

    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
  });
});
