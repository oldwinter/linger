import { describe, expect, it } from "vitest";

import {
  countRoomDocumentText,
  roomDocumentTextCountLabel,
} from "./room-document-text-count";

describe("Room Document text count", () => {
  it("counts nothing for an empty or whitespace-only Document", () => {
    expect(countRoomDocumentText("")).toEqual({ characters: 0, words: 0 });
    expect(countRoomDocumentText("   \n\n\t ")).toEqual({
      characters: 0,
      words: 0,
    });
  });

  it("counts punctuation as part of the word around it", () => {
    expect(countRoomDocumentText("Hello, world!")).toEqual({
      characters: 12,
      words: 2,
    });
  });

  it("counts runs of non-whitespace, whatever the spacing", () => {
    expect(countRoomDocumentText("Hello    world\n\n\nsecond\tline")).toEqual({
      characters: 20,
      words: 4,
    });
  });

  it("keeps a long word one word", () => {
    expect(countRoomDocumentText("Supercalifragilisticexpialidocious")).toEqual(
      { characters: 34, words: 1 },
    );
  });

  it("counts a code block's content once, without its fences", () => {
    expect(countRoomDocumentText("```ts\nconst answer = 42;\n```")).toEqual({
      characters: 15,
      words: 4,
    });
  });

  it("does not count heading, list or emphasis markers", () => {
    expect(countRoomDocumentText("## Title\n\n- **Bold** and `code`")).toEqual({
      characters: 16,
      words: 4,
    });
  });

  it("labels the count with singular and plural nouns", () => {
    expect(roomDocumentTextCountLabel({ characters: 1, words: 1 })).toBe(
      "1 word · 1 character",
    );
    expect(roomDocumentTextCountLabel({ characters: 24, words: 3 })).toBe(
      "3 words · 24 characters",
    );
  });
});
