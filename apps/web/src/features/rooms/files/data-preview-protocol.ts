export const dataPreviewLimits = {
  chunkBytes: 256 * 1024,
  maxBytes: 5 * 1024 * 1024,
  maxCellCharacters: 64 * 1024,
  maxCells: 500_000,
  maxColumns: 200,
  maxRows: 10_000,
  timeoutMs: 15_000,
} as const;

export interface DataPreviewRequest {
  blob: Blob;
  delimiter: "," | "\t";
  requestId: string;
  sourceSizeBytes: number;
}

/**
 * Which limit cut a preview short. The worker has no language, so the
 * adapter words it.
 */
export type DataPreviewTruncation = "bytes" | "cells" | "columns" | "rows";

/** Why the worker could not parse the data, for the adapter to word. */
export type DataPreviewFailure =
  | { code: "parse"; detail: string; row: number }
  | { code: "cellTooLarge" }
  | { code: "firstRecordTooLarge" };

export type DataPreviewResponse =
  | {
      kind: "parsed";
      requestId: string;
      rows: string[][];
      truncated: boolean;
      truncation?: DataPreviewTruncation;
    }
  | {
      kind: "failed";
      failure: DataPreviewFailure;
      /** The failure in English, for developers. */
      message: string;
      requestId: string;
    };
