/**
 * Every kind of model call, and how call management treats it. Adding a kind
 * of model call is adding a policy row.
 */

/** One-shot calls and chains; the only kinds the HTTP contract accepts. */
const modelCallKinds = [
  "approval",
  "voice_ask",
  "meeting_notes",
  "memory",
  "agent_memory",
  "wiki",
  "profile",
  "insight",
] as const;
export type ModelCallKind = (typeof modelCallKinds)[number];

/** What queued a Run. */
export type RunKind =
  | "chat"
  | "agent_message"
  | "task"
  | "task_callback"
  | "routine"
  | "proactive"
  | "follow_up"
  | "document";

/** Smaller priorities go first. Work up to chat may use the last place and
 * swaps out a running Run of a lower priority when it cannot start. */
export const runPriorities: Readonly<Record<RunKind, number>> = {
  chat: 10,
  task: 12,
  task_callback: 12,
  document: 12,
  agent_message: 12,
  routine: 15,
  proactive: 15,
  follow_up: 15,
};
export interface ModelLeaseResult {
  readonly outcome: string;
  /** Token usage as the Runtime reported it; only logged. */
  readonly usage?: unknown;
}

export interface ModelLease {
  /** A sent approval or chain step keeps the place until its Runtime reply. */
  borrow(): Pick<ModelLease, "release">;
  /** Frees the place once all borrowers finish. Later calls do nothing. */
  release(result: ModelLeaseResult): void;
}

/** A bounded Computer resolves an unknown Meta priority only when work contends. */
export type CapacityPriority =
  | number
  | {
      /** Monotonic arrival time retained across priority refreshes for this wait. */
      readonly queuedAt: number;
      resolve(): Promise<number>;
    };

/** A question or the notes of a recording go before chat. */
export const RECORDING_PRIORITY = 5;

export const COMPACTION_PRIORITY = 20;

export function softLimit(hard: number): number {
  return Math.max(1, hard - 1);
}

export function admissionLimit(hard: number, priority: number): number {
  return priority <= runPriorities.chat ? hard : softLimit(hard);
}

export interface ModelCallPolicy {
  /** Smaller numbers start first, in arrival order within one priority. */
  readonly priority: number;
  /** Someone waits on the answer: the call stops once nobody waits, and
   * over HTTP it never answers pending. */
  readonly interactive: boolean;
  /** Runtime attempts of one call, a lone call or a chain's, corrections
   * included. Callers do not retry a call themselves. */
  readonly attempts: number;
  /** One Runtime attempt when the request names none. The Runtime counts it
   * from the attempt's start, so waiting for a place never counts. */
  readonly timeoutMs: number;
}

export const modelCallPolicies: Readonly<
  Record<ModelCallKind, ModelCallPolicy>
> = {
  approval: {
    priority: 0,
    interactive: true,
    attempts: 1,
    timeoutMs: 15_000,
  },
  voice_ask: {
    priority: RECORDING_PRIORITY,
    interactive: true,
    attempts: 1,
    timeoutMs: 45_000,
  },
  meeting_notes: {
    priority: RECORDING_PRIORITY,
    interactive: true,
    attempts: 1,
    timeoutMs: 20_000,
  },
  agent_memory: {
    priority: 30,
    interactive: false,
    attempts: 2,
    timeoutMs: 10 * 60_000,
  },
  memory: {
    priority: 40,
    interactive: false,
    attempts: 3,
    timeoutMs: 10 * 60_000,
  },
  profile: {
    priority: 50,
    interactive: false,
    attempts: 2,
    timeoutMs: 2 * 60_000,
  },
  insight: {
    priority: 60,
    interactive: false,
    attempts: 2,
    timeoutMs: 2 * 60_000,
  },
  wiki: {
    priority: 70,
    interactive: false,
    attempts: 2,
    timeoutMs: 10 * 60_000,
  },
};

export function isModelCallKind(value: unknown): value is ModelCallKind {
  return (
    typeof value === "string" &&
    (modelCallKinds as readonly string[]).includes(value)
  );
}
