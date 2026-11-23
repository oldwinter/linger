export type SchemaErrorCode =
  | "INVALID_SCHEMA"
  | "MISSING_SCHEMA_DESCRIPTION"
  | "UNSUPPORTED_SCHEMA_REFERENCE";

export class SchemaError extends Error {
  readonly code: SchemaErrorCode;
  readonly path?: string;

  constructor(
    code: SchemaErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly path?: string },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SchemaError";
    this.code = code;
    this.path = options?.path;
  }
}
