import { describe, expect, it } from "vitest";

import { pocketNotesMatching } from "./pocket-note-find";

const notes = [
  { date: "2026-11-14", label: "Today", text: "Buy **milk**" },
  { date: "2026-09-30", label: "Sep 30", text: "Yesterday's idea" },
];

describe("pocket note search", () => {
  it("returns every loaded note when the query is blank", () => {
    expect(pocketNotesMatching(notes, "  ")).toEqual(notes);
  });

  it("matches the label, the day, or the note's words", () => {
    expect(pocketNotesMatching(notes, "sep").map((note) => note.date)).toEqual([
      "2026-09-30",
    ]);
    expect(
      pocketNotesMatching(notes, "2026-11").map((note) => note.date),
    ).toEqual(["2026-11-14"]);
    expect(pocketNotesMatching(notes, "milk").map((note) => note.date)).toEqual(
      ["2026-11-14"],
    );
    expect(pocketNotesMatching(notes, "orchid")).toEqual([]);
  });
});
