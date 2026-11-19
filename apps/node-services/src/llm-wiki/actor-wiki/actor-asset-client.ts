export type GenerationFailureDisposition = "retryable" | "terminal";

export type ActorAssetErrorCode =
  | "WIKI_OPERATION_FAILED"
  | "WIKI_OPERATION_RETRYABLE"
  | "WIKI_COMPUTER_OFFLINE"
  | "WIKI_RUNTIME_INCOMPATIBLE"
  | "WIKI_RUNTIME_AUTH_REQUIRED"
  | "WIKI_RUNTIME_UNAVAILABLE";

export class ActorAssetError extends Error {
  constructor(
    readonly code: ActorAssetErrorCode,
    message: string,
    readonly disposition: GenerationFailureDisposition = code ===
    "WIKI_OPERATION_FAILED"
      ? "terminal"
      : "retryable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ActorAssetError";
  }
}
