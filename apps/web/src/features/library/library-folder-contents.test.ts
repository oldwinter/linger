import { describe, expect, it } from "vitest";

import { folderContentsMarkdown } from "./library-folder-contents";

const origin = "https://app.example";
const tenantId = "tenant-one";

function document(id: string, title: string) {
  return { format: "blocknote", id, representation_format: "markdown", title };
}

describe("folderContentsMarkdown", () => {
  it("writes the folder name over one linked document", () => {
    expect(
      folderContentsMarkdown({
        documents: [document("doc-alpha", "Alpha plan")],
        folderName: "Design",
        origin,
        tenantId,
      }),
    ).toBe(
      [
        "# Design",
        "",
        "- [Alpha plan.md](https://app.example/t/tenant-one/documents/doc-alpha)",
      ].join("\n"),
    );
  });

  it("keeps the order the folder list shows", () => {
    expect(
      folderContentsMarkdown({
        documents: [
          document("doc-bravo", "Bravo plan"),
          document("doc-alpha", "Alpha plan"),
          document("doc-notes", "Notes"),
        ],
        folderName: "Design",
        origin,
        tenantId,
      }),
    ).toBe(
      [
        "# Design",
        "",
        "- [Bravo plan.md](https://app.example/t/tenant-one/documents/doc-bravo)",
        "- [Alpha plan.md](https://app.example/t/tenant-one/documents/doc-alpha)",
        "- [Notes.md](https://app.example/t/tenant-one/documents/doc-notes)",
      ].join("\n"),
    );
  });

  it("writes only the heading for an empty folder", () => {
    expect(
      folderContentsMarkdown({
        documents: [],
        folderName: "Design",
        origin,
        tenantId,
      }),
    ).toBe("# Design");
  });

  it("writes a name with Markdown characters as it is", () => {
    expect(
      folderContentsMarkdown({
        documents: [document("doc-draft", "Plan [draft] *final*")],
        folderName: "Design [v2] *final*",
        origin,
        tenantId,
      }),
    ).toBe(
      [
        "# Design [v2] *final*",
        "",
        "- [Plan \\[draft\\] *final*.md](https://app.example/t/tenant-one/documents/doc-draft)",
      ].join("\n"),
    );
  });
});
