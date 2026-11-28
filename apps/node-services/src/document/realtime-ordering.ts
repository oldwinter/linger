import { RuntimeConnectionError } from "./connection-token.js";

const maxWaitingOperationsPerDocument = 128;

export interface DocumentOrderingLease {
  release(): void;
  remainingMilliseconds(): number;
}

interface DocumentOrderingRequest {
  lease: Promise<DocumentOrderingLease>;
  extendDeadline(deadlineAt: number): void;
}

interface WaitingOperation {
  abort?: () => void;
  deadlineAt: number;
  queueName: string;
  reject(error: Error): void;
  resolve(lease: DocumentOrderingLease): void;
  signal?: AbortSignal;
  timeout: ReturnType<typeof setTimeout>;
}

interface DocumentOrderingState {
  active: boolean;
  waiting: WaitingOperation[];
}

export class DocumentOrderingQueue {
  readonly #documents = new Map<string, DocumentOrderingState>();

  acquireMutation(
    documentId: string,
    timeoutMs: number,
  ): Promise<DocumentOrderingLease> {
    return this.#acquire(documentId, timeoutMs, "Document mutation queue")
      .lease;
  }

  acquireSessionLoad(
    documentId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<DocumentOrderingLease> {
    return this.#acquire(
      documentId,
      timeoutMs,
      "Document session load queue",
      signal,
    ).lease;
  }

  #acquire(
    documentId: string,
    timeoutMs: number,
    queueName: string,
    signal?: AbortSignal,
  ): DocumentOrderingRequest {
    if (signal?.aborted) {
      return {
        lease: Promise.reject(
          new RuntimeConnectionError("Document connection admission expired"),
        ),
        extendDeadline: () => undefined,
      };
    }
    const deadlineAt = Date.now() + timeoutMs;
    const existing = this.#documents.get(documentId);
    const state = existing ?? { active: false, waiting: [] };
    if (existing === undefined) {
      this.#documents.set(documentId, state);
    }
    if (!state.active) {
      state.active = true;
      return {
        lease: Promise.resolve(this.#lease(documentId, state, deadlineAt)),
        extendDeadline: () => undefined,
      };
    }
    if (state.waiting.length >= maxWaitingOperationsPerDocument) {
      throw new RuntimeConnectionError(`${queueName} is full`);
    }
    let waiting!: WaitingOperation;
    const lease = new Promise<DocumentOrderingLease>((resolve, reject) => {
      waiting = {
        deadlineAt,
        queueName,
        reject,
        resolve,
        ...(signal === undefined ? {} : { signal }),
        timeout: undefined as unknown as ReturnType<typeof setTimeout>,
      };
      if (signal !== undefined) {
        waiting.abort = () => {
          const index = state.waiting.indexOf(waiting);
          if (index >= 0) {
            state.waiting.splice(index, 1);
          }
          clearTimeout(waiting.timeout);
          if (!state.active && state.waiting.length === 0) {
            this.#documents.delete(documentId);
          }
          waiting.reject(
            new RuntimeConnectionError("Document connection admission expired"),
          );
        };
        signal.addEventListener("abort", waiting.abort, { once: true });
      }
      waiting.timeout = this.#waitingTimeout(documentId, state, waiting);
      state.waiting.push(waiting);
    });
    return {
      lease,
      extendDeadline: (extendedDeadlineAt) => {
        if (
          extendedDeadlineAt <= waiting.deadlineAt ||
          !state.waiting.includes(waiting)
        ) {
          return;
        }
        waiting.deadlineAt = extendedDeadlineAt;
        clearTimeout(waiting.timeout);
        waiting.timeout = this.#waitingTimeout(documentId, state, waiting);
      },
    };
  }

  #waitingTimeout(
    documentId: string,
    state: DocumentOrderingState,
    waiting: WaitingOperation,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(
      () => {
        const index = state.waiting.indexOf(waiting);
        if (index >= 0) {
          state.waiting.splice(index, 1);
        }
        if (waiting.signal !== undefined && waiting.abort !== undefined) {
          waiting.signal.removeEventListener("abort", waiting.abort);
        }
        if (!state.active && state.waiting.length === 0) {
          this.#documents.delete(documentId);
        }
        waiting.reject(
          new RuntimeConnectionError(`${waiting.queueName} timed out`),
        );
      },
      Math.max(1, waiting.deadlineAt - Date.now()),
    );
  }

  #lease(
    documentId: string,
    state: DocumentOrderingState,
    deadlineAt: number,
  ): DocumentOrderingLease {
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.#advance(documentId, state);
      },
      remainingMilliseconds: () => Math.max(1, deadlineAt - Date.now()),
    };
  }

  #advance(documentId: string, state: DocumentOrderingState): void {
    for (;;) {
      const next = state.waiting.shift();
      if (next === undefined) {
        state.active = false;
        this.#documents.delete(documentId);
        return;
      }
      clearTimeout(next.timeout);
      if (next.signal !== undefined && next.abort !== undefined) {
        next.signal.removeEventListener("abort", next.abort);
      }
      if (next.deadlineAt <= Date.now()) {
        next.reject(new RuntimeConnectionError(`${next.queueName} timed out`));
        continue;
      }
      next.resolve(this.#lease(documentId, state, next.deadlineAt));
      return;
    }
  }
}
