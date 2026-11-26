import {
  ROOM_DOCUMENT_SCHEMA_VERSION,
  ROOM_DOCUMENT_STATE_HASH_VERSION,
} from "@linger/document-model";
import { sha256Hex } from "@linger/service-kit/node";

import type { DocumentBodyStore } from "./bodies.js";
import type { DocumentDurabilityCoordinator } from "./realtime-durability.js";
import type { DocumentOrderingQueue } from "./realtime-ordering.js";
import { documentLogger } from "./log.js";

type ChangeDurability = Pick<
  DocumentDurabilityCoordinator,
  | "captureCommittedState"
  | "commitExternalUpdate"
  | "settleAppend"
  | "hasDocument"
  | "getPermanentFailure"
  | "reconcileSavedBody"
  | "noteBodyChange"
>;

interface ResidentDocument {
  waitForBroadcast(): Promise<void>;
}

/** The state a change produces from the body it was computed on. */
export interface ComputedDocumentChange {
  update: Uint8Array;
  stateBytes: Uint8Array;
  stateVector: Uint8Array;
  title: string;
  assetIds: string[];
  threadIds: string[];
}

export type DocumentChangeComputation = (
  stateBytes: Uint8Array,
) => Promise<ComputedDocumentChange | { conflict: string }>;

export type DocumentChangeResult =
  | {
      status: "applied";
      seq: number;
      stateHash: string;
      title: string;
      assetIds: string[];
      threadIds: string[];
    }
  | { status: "conflicted"; reason: string };

const changeDeadlineMs = 25_000;
// Each attempt reads the body afresh; only a concurrent save forces another.
const maxAttempts = 3;

/**
 * Applies TeamHub's authorized server changes to a Document's online body:
 * on the resident Document when it is open, otherwise on the saved body. The
 * body is saved before the update reaches any connection, so a change is
 * either saved and broadcast or not applied at all. The body records each
 * change's operation ID with the save, so a retry of a change that was saved
 * reports it applied instead of applying it again.
 */
export class DocumentChangeCoordinator {
  readonly #durability: ChangeDurability;
  readonly #ordering: DocumentOrderingQueue;
  readonly #bodies: DocumentBodyStore;
  readonly #getResidentDocument: (
    documentId: string,
  ) => ResidentDocument | undefined;

  constructor(input: {
    durability: ChangeDurability;
    ordering: DocumentOrderingQueue;
    bodies: DocumentBodyStore;
    getResidentDocument(documentId: string): ResidentDocument | undefined;
  }) {
    this.#durability = input.durability;
    this.#ordering = input.ordering;
    this.#bodies = input.bodies;
    this.#getResidentDocument = input.getResidentDocument;
  }

  async apply(input: {
    documentId: string;
    operationId: string;
    actorId: string;
    expectedSeq?: number;
    compute: DocumentChangeComputation;
  }): Promise<DocumentChangeResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const lease = await this.#ordering.acquireMutation(
        input.documentId,
        changeDeadlineMs,
      );
      let attemptedSave = false;
      try {
        const earlier = await this.#bodies.findOperation(
          input.documentId,
          input.operationId,
        );
        if (earlier !== undefined) {
          const reconciled = await this.#reconcileResident(
            input.documentId,
            earlier.seq,
          );
          if (reconciled === "missing") throw new DocumentNotFoundError();
          return { status: "applied", ...earlier };
        }
        const base = await this.#readBase(input.documentId);
        if (input.expectedSeq !== undefined && input.expectedSeq !== base.seq) {
          return { status: "conflicted", reason: "stale_head" };
        }
        const computed = await input.compute(base.stateBytes);
        if ("conflict" in computed) {
          return { status: "conflicted", reason: computed.conflict };
        }
        const assetIds = [...computed.assetIds].sort();
        const threadIds = [...computed.threadIds].sort();
        attemptedSave = true;
        const saved = await this.#bodies.save({
          documentId: input.documentId,
          baseSeq: base.seq,
          state: computed.stateBytes,
          stateVector: computed.stateVector,
          assetIds,
          threadIds,
          editorIds: [input.actorId],
          historyPoints: false,
          operation: { id: input.operationId, title: computed.title },
        });
        if (saved.kind === "stale") {
          const reconciled = await this.#reconcileResident(input.documentId);
          if (reconciled === "missing") throw new DocumentNotFoundError();
          continue;
        }
        if (saved.kind === "rejected") throw new DocumentNotFoundError();
        const stateHash = sha256Hex(computed.stateBytes);
        await this.#publish(input.documentId, base.seq, computed, {
          document_id: input.documentId,
          schema_version: ROOM_DOCUMENT_SCHEMA_VERSION,
          persisted_seq: saved.seq,
          state_vector: Buffer.from(computed.stateVector).toString("base64"),
          state_hash: stateHash,
          state_hash_version: ROOM_DOCUMENT_STATE_HASH_VERSION,
        });
        return {
          status: "applied",
          seq: saved.seq,
          stateHash,
          title: computed.title,
          assetIds,
          threadIds,
        };
      } finally {
        if (attemptedSave) {
          this.#durability.noteBodyChange(input.documentId);
        }
        lease.release();
      }
    }
    throw new DocumentChangeError(
      "The Document body kept moving while the change was applied",
    );
  }

  async #readBase(
    documentId: string,
  ): Promise<{ seq: number; stateBytes: Uint8Array }> {
    if (this.#durability.hasDocument(documentId)) {
      if (this.#durability.getPermanentFailure(documentId) !== undefined) {
        throw new DocumentChangeError("The resident Document failed to save");
      }
      // A batch on the wire must land first, so the change meets its head.
      await this.#durability.settleAppend(documentId);
      if (this.#durability.hasDocument(documentId)) {
        if (this.#durability.getPermanentFailure(documentId) !== undefined) {
          throw new DocumentChangeError("The resident Document failed to save");
        }
        const captured = this.#durability.captureCommittedState(documentId);
        return {
          seq: captured.head.persisted_seq,
          stateBytes: captured.stateBytes,
        };
      }
    }
    const loaded = await this.#bodies.load(documentId);
    if (loaded === undefined) throw new DocumentNotFoundError();
    return { seq: loaded.seq, stateBytes: loaded.state };
  }

  async #reconcileResident(
    documentId: string,
    minSeq?: number,
  ): Promise<"adopted" | "current" | "unopened" | "missing"> {
    if (
      !this.#durability.hasDocument(documentId) ||
      this.#durability.getPermanentFailure(documentId) !== undefined
    ) {
      return "unopened";
    }
    const result = await this.#durability.reconcileSavedBody(
      documentId,
      minSeq === undefined ? undefined : { minSeq },
    );
    if (result === "adopted") {
      const resident = this.#getResidentDocument(documentId);
      if (resident !== undefined) await resident.waitForBroadcast();
    }
    return result;
  }

  // A Document that opened while the change ran registered either the base
  // or the saved body; only one still on the base takes the update. One that
  // registers later loads the saved body.
  async #publish(
    documentId: string,
    baseSeq: number,
    computed: ComputedDocumentChange,
    head: Parameters<
      ChangeDurability["commitExternalUpdate"]
    >[0]["committedHead"],
  ): Promise<void> {
    if (
      !this.#durability.hasDocument(documentId) ||
      this.#durability.getPermanentFailure(documentId) !== undefined
    ) {
      return;
    }
    const currentSeq =
      this.#durability.captureCommittedState(documentId).head.persisted_seq;
    if (currentSeq !== baseSeq) {
      if (currentSeq < head.persisted_seq) {
        await this.#reconcileResident(documentId, head.persisted_seq);
      } else {
        const resident = this.#getResidentDocument(documentId);
        if (resident !== undefined && computed.update.byteLength > 0) {
          await resident.waitForBroadcast();
        }
      }
      return;
    }
    try {
      this.#durability.commitExternalUpdate({
        documentId,
        basePersistedSeq: baseSeq,
        update: computed.update,
        committedHead: head,
      });
    } catch (error) {
      // The body is saved; fall back to loading and adopting it directly so
      // open connections do not stay behind the committed sequence.
      documentLogger().log("warn", "document.change_publish_deferred", {
        document_id: documentId,
        persisted_seq: head.persisted_seq,
        error_name: error instanceof Error ? error.name : "unknown",
      });
      await this.#reconcileResident(documentId, head.persisted_seq);
      return;
    }
    const resident = this.#getResidentDocument(documentId);
    if (resident === undefined || computed.update.byteLength === 0) return;
    await resident.waitForBroadcast();
  }
}

export class DocumentChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentChangeError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("The Document is not an active native Document");
    this.name = "DocumentNotFoundError";
  }
}
