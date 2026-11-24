import { describe, expect, it } from "vitest";

import {
  createDocumentInputSchema,
  editDocumentInputSchema,
} from "./document-tools.js";

const create = (title: string) =>
  createDocumentInputSchema.parse({ title, markdown: "# Draft" });
const rename = (title: string) =>
  editDocumentInputSchema.parse({
    document_id: "document_one",
    command: "set_title",
    title,
  });

describe("a Document title bound", () => {
  it("counts characters, not UTF-16 code units", () => {
    // 255 astral characters are 510 code units and still fit the bound.
    expect(create("\u{1F600}".repeat(255)).title).toHaveLength(510);
    expect(() => create("\u{1F600}".repeat(256))).toThrow();
    expect(rename("\u{1F600}".repeat(255))).toBeDefined();
    expect(() => rename("\u{1F600}".repeat(256))).toThrow();
  });

  it("keeps the plain bounds for ASCII and the empty refusal", () => {
    expect(create("t".repeat(255)).title).toBe("t".repeat(255));
    expect(() => create("t".repeat(256))).toThrow();
    expect(() => create("")).toThrow();
  });
});
