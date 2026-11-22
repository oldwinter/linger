/// <reference lib="webworker" />

import Papa, { type Parser, type ParseResult } from "papaparse";

import {
  dataPreviewLimits,
  type DataPreviewRequest,
  type DataPreviewResponse,
  type DataPreviewTruncation,
} from "./data-preview-protocol";
import {
  completeRowsInDataPreviewChunk,
  endsAtRecordBoundary,
  firstFatalDataPreviewError,
} from "./data-preview-truncation";

self.addEventListener("message", (event: MessageEvent<DataPreviewRequest>) => {
  void parseData(event.data);
});

async function parseData(request: DataPreviewRequest) {
  const rows: string[][] = [];
  const previewBlob = request.blob.slice(0, dataPreviewLimits.maxBytes);
  const source = new File([previewBlob], "preview-data", {
    type: "text/plain",
  });
  let cells = 0;
  let completed = false;
  let incompleteQuotedRecordRemoved = false;
  let stoppedAtDisplayLimit = false;
  const sourceByteTruncated = request.sourceSizeBytes > previewBlob.size;
  const tail = await previewBlob.slice(-2).text();
  let truncated = sourceByteTruncated;
  let truncation: DataPreviewTruncation | undefined = truncated
    ? "bytes"
    : undefined;

  const finish = (response: DataPreviewResponse) => {
    if (completed) return;
    completed = true;
    self.postMessage(response);
  };

  Papa.parse<string[]>(source, {
    chunk(results: ParseResult<string[]>, parser: Parser) {
      const fatalError = firstFatalDataPreviewError(
        results.errors,
        sourceByteTruncated,
      );
      if (fatalError) {
        const row = fatalError.row ?? rows.length + 1;
        finish({
          kind: "failed",
          failure: { code: "parse", detail: fatalError.message, row },
          message: `Data preview failed near row ${row}: ${fatalError.message}`,
          requestId: request.requestId,
        });
        parser.abort();
        return;
      }

      const completeChunk = completeRowsInDataPreviewChunk(
        results.data,
        results.errors,
        sourceByteTruncated,
      );
      incompleteQuotedRecordRemoved ||=
        completeChunk.incompleteQuotedRecordRemoved;

      for (const rawRow of completeChunk.rows) {
        if (rows.length >= dataPreviewLimits.maxRows) {
          stoppedAtDisplayLimit = true;
          truncated = true;
          truncation = "rows";
          parser.abort();
          break;
        }
        const row = rawRow.slice(0, dataPreviewLimits.maxColumns).map(String);
        if (rawRow.length > dataPreviewLimits.maxColumns) {
          truncated = true;
          truncation = "columns";
        }
        if (
          row.some((cell) => cell.length > dataPreviewLimits.maxCellCharacters)
        ) {
          finish({
            kind: "failed",
            failure: { code: "cellTooLarge" },
            message: "A cell exceeds the 64 KiB basic preview limit.",
            requestId: request.requestId,
          });
          parser.abort();
          return;
        }
        if (cells + row.length > dataPreviewLimits.maxCells) {
          stoppedAtDisplayLimit = true;
          truncated = true;
          truncation = "cells";
          parser.abort();
          break;
        }
        cells += row.length;
        rows.push(row);
      }
    },
    chunkSize: dataPreviewLimits.chunkBytes,
    complete() {
      if (
        sourceByteTruncated &&
        incompleteQuotedRecordRemoved &&
        rows.length === 0
      ) {
        finish({
          kind: "failed",
          failure: { code: "firstRecordTooLarge" },
          message:
            "The first data record exceeds the 5 MiB basic preview limit.",
          requestId: request.requestId,
        });
        return;
      }
      if (
        sourceByteTruncated &&
        !stoppedAtDisplayLimit &&
        !incompleteQuotedRecordRemoved &&
        !endsAtRecordBoundary(tail) &&
        rows.length > 0
      ) {
        rows.pop();
      }
      finish({
        kind: "parsed",
        requestId: request.requestId,
        rows,
        truncated,
        truncation,
      });
    },
    delimiter: request.delimiter,
    dynamicTyping: false,
    encoding: "UTF-8",
    skipEmptyLines: "greedy",
  });
}
