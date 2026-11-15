// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { readToldPart, writeToldPart } from "./meeting-told-part";

describe("meeting told part", () => {
  it("keeps the sentence for that account and meeting", () => {
    localStorage.clear();
    expect(readToldPart("account-1", "meeting-1")).toBeUndefined();
    writeToldPart(
      "account-1",
      "meeting-1",
      "You decided: Ship the Friday release.",
    );
    expect(readToldPart("account-1", "meeting-1")).toBe(
      "You decided: Ship the Friday release.",
    );
    expect(readToldPart("account-2", "meeting-1")).toBeUndefined();
    expect(readToldPart("account-1", "meeting-2")).toBeUndefined();
  });
});
