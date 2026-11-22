import type { AnotherMeActor, ModelRunBudget } from "../runtime-model-call.js";

export interface WikiInputSnapshot {
  assetKey: string;
  contentSha256: string;
  sourceUrl: string;
  title: string;
}

/** Where a Session source goes and what its page may cite. */
export interface WikiSessionRouting {
  /** The dated Session page: `sessions/<date>/<session id>.md`. */
  targetPath: string;
  date: string;
  /** Room messages, or a recording's transcript Document version. */
  citations: string[];
}

export interface WikiInput extends WikiInputSnapshot {
  contentPath: string;
  /** Present for a Room or recording Session of the Memory index. */
  session?: WikiSessionRouting;
}

export interface WikiChangeSet {
  added: WikiInput[];
  modified: WikiInput[];
  removed: WikiInputSnapshot[];
}

export interface LlmWikiGenerateRequest {
  changes: WikiChangeSet;
  /** The Another Me whose Computer runs the generation. */
  generator: AnotherMeActor;
  existingOutputDirectory: string;
  generationId?: string;
  onPreviewPage?: (path: string, markdown: string | null) => void;
  inputsDirectory: string;
  mode: "initialize" | "update";
  outputDirectory: string;
  /** Stops waiting for the Runtime when the caller has gone away. */
  signal?: AbortSignal;
  /** Model time the generation may spend; once spent, no further model task
   * or step starts and what is left unwritten is reported deferred. */
  budget?: ModelRunBudget;
}

export interface LlmWikiGenerateResult {
  pageCount: number;
  /** Asset keys of changed sources a failed task left unwritten. TeamHub
   * keeps them pending so a later refresh writes them, a bounded number of
   * times. */
  unsettled: string[];
  /** Asset keys of changed sources left unwritten only because the
   * generation's budget was spent. TeamHub keeps them pending without
   * counting a try. */
  deferred: string[];
}

export interface LlmWikiBackend {
  readonly id: string;
  /** Changes whenever the same inputs would generate differently. */
  readonly generationKey: string;
  generate(request: LlmWikiGenerateRequest): Promise<LlmWikiGenerateResult>;
}
