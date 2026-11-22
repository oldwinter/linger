// @vitest-environment jsdom
import {
  materializeRoomDocument,
  readRoomDocumentBlocks,
} from "@linger/document-model";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { normalizeDocumentContent } from "../../src/document-normalizer/document-normalizer-core.js";

function source(format: string, value: string): Uint8Array {
  const rows = [
    ["Record", "Value"],
    ["item", value],
  ];
  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      "Data",
    );
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }
  const separator = format === "csv" ? "," : "\t";
  return new TextEncoder().encode(
    rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(separator),
      )
      .join("\n"),
  );
}

describe("literal table data", () => {
  for (const format of ["csv", "tsv", "xlsx"]) {
    it.each([
      [
        "Markdown punctuation",
        "C:\\temp\\| **bold** `code` _under_ ~~strike~~ [label](target)",
        "C:\\temp\\| **bold** `code` _under_ ~~strike~~ [label](target)",
      ],
      [
        "carriage returns",
        "first\rsecond\r\nthird\nfourth",
        "first second third fourth",
      ],
    ])(
      `preserves %s from ${format} in an editable table cell`,
      async (_name, value, expected) => {
        const markdown = await normalizeDocumentContent({
          filename: `table.${format}`,
          mediaType: "application/octet-stream",
          source: source(format, value),
        });
        const state = await materializeRoomDocument({
          materializationId: "25c9e991-7cc8-47c0-9e80-b6d748cae919",
          schemaVersion: 1,
          sourceKind: "markdown",
          sourceBytes: markdown,
        });
        const table = readRoomDocumentBlocks(state.stateBytes).find(
          (block) => block.type === "table",
        );
        expect(table?.type).toBe("table");
        if (!table || table.type !== "table")
          throw new Error("Missing imported table");
        const cells = table.content.rows.map((row) =>
          row.cells.map((cell) => (Array.isArray(cell) ? cell : cell.content)),
        );
        expect(cells).toEqual([
          [
            [{ type: "text", text: "Record", styles: {} }],
            [{ type: "text", text: "Value", styles: {} }],
          ],
          [
            [{ type: "text", text: "item", styles: {} }],
            [{ type: "text", text: expected, styles: {} }],
          ],
        ]);
      },
    );
  }
});
