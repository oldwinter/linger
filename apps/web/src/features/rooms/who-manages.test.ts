import { describe, expect, it } from "vitest";

import { leavesNoOwner, roleWrites, type ManagePerson } from "./who-manages";

const jenny: ManagePerson = { id: "jenny", kind: "human", role: "owner" };
const maya: ManagePerson = { id: "maya", kind: "human", role: "member" };
const codex: ManagePerson = { id: "codex", kind: "agent", role: "member" };

describe("roleWrites", () => {
  it("promotes someone before it removes the last other owner", () => {
    const chosen = new Map<string, "member" | "owner">([
      ["jenny", "member"],
      ["maya", "owner"],
    ]);
    expect(roleWrites([jenny, maya, codex], chosen)).toEqual([
      { id: "maya", role: "owner" },
      { id: "jenny", role: "member" },
    ]);
    expect(leavesNoOwner([jenny, maya], new Map([["jenny", "member"]]))).toBe(
      true,
    );
  });
});
