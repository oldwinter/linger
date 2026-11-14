import { describe, expect, it } from "vitest";

import { selectedDocumentsMarkdown } from "./library-selection-links";

const origin = "https://app.example";
const tenantId = "tenant-one";

function document(id: string, title: string) {
  return { format: "blocknote", id, representation_format: "markdown", title };
}

describe("selectedDocumentsMarkdown", () => {
  it("lists the selection in the order given", () => {
    expect(
      selectedDocumentsMarkdown({
        documents: [
          document("doc-bravo", "Bravo plan"),
          document("doc-alpha", "Alpha plan"),
          document("doc-notes", "Notes"),
        ],
        origin,
        tenantId,
      }),
    ).toBe(
      [
        "- [Bravo plan.md](https://app.example/t/tenant-one/documents/doc-bravo)",
        "- [Alpha plan.md](https://app.example/t/tenant-one/documents/doc-alpha)",
        "- [Notes.md](https://app.example/t/tenant-one/documents/doc-notes)",
      ].join("\n"),
    );
  });

  it("writes one bullet for one document", () => {
    expect(
      selectedDocumentsMarkdown({
        documents: [document("doc-alpha", "Alpha plan")],
        origin,
        tenantId,
      }),
    ).toBe(
      "- [Alpha plan.md](https://app.example/t/tenant-one/documents/doc-alpha)",
    );
  });

  it("keeps the name inside the link text", () => {
    expect(
      selectedDocumentsMarkdown({
        documents: [document("doc-draft", "Plan [draft]")],
        origin,
        tenantId,
      }),
    ).toBe(
      "- [Plan \\[draft\\].md](https://app.example/t/tenant-one/documents/doc-draft)",
    );
  });

  it("skips a document whose link cannot be built", () => {
    expect(
      selectedDocumentsMarkdown({
        documents: [
          document("doc-alpha", "Alpha plan"),
          document(" ", "Loose"),
        ],
        origin,
        tenantId,
      }),
    ).toBe(
      "- [Alpha plan.md](https://app.example/t/tenant-one/documents/doc-alpha)",
    );
    expect(
      selectedDocumentsMarkdown({
        documents: [document("doc-alpha", "Alpha plan")],
        origin: "not a url",
        tenantId,
      }),
    ).toBe("");
  });
});
