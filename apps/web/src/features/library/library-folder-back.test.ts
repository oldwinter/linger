import { describe, expect, it } from "vitest";

import { libraryFolderBackPath } from "./library-folder-back";

describe("libraryFolderBackPath", () => {
  it("returns the folder that holds the open file", () => {
    expect(
      libraryFolderBackPath(
        "tenant-northstar",
        [
          { node_kind: "folder" },
          {
            document_id: "document-plan",
            node_kind: "document",
            parent_id: "folder-notes",
          },
        ],
        "document-plan",
      ),
    ).toBe("/t/tenant-northstar/library?folder=folder-notes");
  });

  it("returns the library home when the file sits at the root or is not in the tree", () => {
    expect(
      libraryFolderBackPath(
        "tenant-northstar",
        [{ document_id: "document-plan", node_kind: "document" }],
        "document-plan",
      ),
    ).toBe("/t/tenant-northstar/library");
    expect(libraryFolderBackPath("tenant-northstar", [], "document-plan")).toBe(
      "/t/tenant-northstar/library",
    );
    expect(libraryFolderBackPath("tenant-northstar", [], undefined)).toBe(
      "/t/tenant-northstar/library",
    );
  });
});
