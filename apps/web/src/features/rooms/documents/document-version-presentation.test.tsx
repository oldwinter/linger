import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createDocumentTestRuntime,
  seedRoomUpload,
} from "@/test/document-scenarios";
import { DocumentVersionPreview } from "./document-version-preview";

describe("Document Version knowledge presentation", () => {
  it.each(["wiki_source", "wiki_page", "room"] as const)(
    "uses knowledge presentation only for generated Wiki pages, not %s sources",
    async (bindingKind) => {
      const runtime = createDocumentTestRuntime();

      const document = await seedRoomUpload(
        runtime,
        `presentation-${bindingKind}`,
        {
          file: new File(
            ["# Original\n\n## Sources\n\nKeep this."],
            "original.md",
            {
              type: "text/markdown",
            },
          ),
          representationFormat: "markdown",
        },
        "tenant-northstar",
      );
      render(
        <DocumentVersionPreview
          client={runtime.client}
          document={{
            ...document,
            from: [{ binding_kind: bindingKind, context_id: "context" }],
          }}
        />,
      );
      const title = await screen.findByText("Original");
      expect(
        title
          .closest(".read-only-blocknote-document")!
          .className.includes("read-only-blocknote-document--knowledge"),
      ).toBe(bindingKind === "wiki_page");
    },
  );
});
