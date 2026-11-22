---
name: document-durability
description: "Formal TLA+ model check for native Room Document online body durability and server-change coherence in apps/node-services/src/document/. Use when editing realtime-session.ts, realtime-durability.ts, realtime-durability-batches.ts, realtime-preflight.ts, document-changes.ts, bodies.ts, or realtime.ts, or when changing how client edits, durability flushes, session opens/closes, and TeamHub server changes share document_bodies."
---

# Document Durability Verification

Model-checks every interleaving across `await` boundaries on the Document Runtime worker thread between WebSocket session opening/unloading, client edits, background durability flushes, and TeamHub server changes (`semantic`, `restore`, `comment_anchor`) sharing `document_bodies`.

- **Sync commit**: `df68b59ccff3a4c99a8026e1a628510250b41663`
- **Baseline outcome at sync commit**: `NoDeadlock` **PASS**, `CommittedEditsPreserved` **PASS**, `ResidentHasAppliedChange` **FAIL** (current code breaks `ResidentHasAppliedChange`; do not weaken the property or edit product code unless fixing the bug is the task).
- **Check command**: `node .agents/skills/document-durability/scripts/check.mjs`
- **Result presentation**: Read every check result with the `/statechart` skill (never copy `/statechart` paths, flags, or scripts into this skill).

## Properties Checked

- **`NoDeadlock`** (`CHECK_DEADLOCK TRUE`): No reachable protocol state stalls without an outgoing transition (`PASS` at sync commit).
- **`CommittedEditsPreserved`**: Every edit acknowledged to a client as Saved (`durability_ack`) or returned to TeamHub as an `applied` server change remains stored in `document_bodies`, and no `durability_ack` ever leads `document_bodies`.
  - **Harm prevented**: A user sees Saved in the editor (or TeamHub confirms an Agent edit or History restore) and later loses that content on reload or a subsequent save.
- **`ResidentHasAppliedChange`**: Whenever `DocumentChangeCoordinator.apply` reports `status: "applied"` at sequence `s` and the Document settles open with no session load or durability flush in flight, the resident durable head is at least sequence `s` and includes that server change.
  - **Harm prevented**: Connected editors keep viewing outdated content after a server change succeeds, follow-up server changes with `expected_seq = s` falsely conflict with `stale_head`, and unsequenced server changes exhaust retries and return HTTP 503.

## Coverage Record

| Source file and functions                                                                                                                                                                                                                                          | Role in protocol                                                                                                              | Model counterpart in [DocumentDurability.tla](./DocumentDurability.tla)                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [realtime-session.ts](../../../apps/node-services/src/document/realtime-session.ts) (`DocumentSessionManager.open`, `load`)                                                                                                                                        | Loads `document_bodies` + `permissionCount`, verifies body across `await`, then registers resident queue                      | `SessionOpenLoad`, `SessionOpenRegister`                                                                      |
| [realtime.ts](../../../apps/node-services/src/document/realtime.ts) (`connected`, `onChange`, `onStoreDocument`, `beforeUnloadDocument`, `afterUnloadDocument`)                                                                                                    | Emits initial and committed `durability_ack`, records applied frames, flushes and unloads resident doc                        | `SessionOpenRegister`, `SessionCloseUnload`, `ackedSeq`, `ackedEdits`                                         |
| [realtime-preflight.ts](../../../apps/node-services/src/document/realtime-preflight.ts) (`DocumentMutationPreflight.authorizeSync`)                                                                                                                                | Acquires `DocumentOrderingQueue`, validates write, reserves backlog slot                                                      | `ClientMutate`, `orderingLocked`                                                                              |
| [realtime-durability.ts](../../../apps/node-services/src/document/realtime-durability.ts) (`registerDocument`, `reserveMutation`, `recordAppliedMutation`, `flush`, `#drain`, `#adoptSavedBody`, `#saveUntilCommitted`, `commitExternalUpdate`, `releaseDocument`) | Owns resident durable Y.Doc head, pending queue, `appendSettled`, stale adoption, lost-reply retry                            | `SessionOpenRegister`, `DrainStart`, `DrainSaveSuccess`, `DrainSaveLostReply`, `DrainSaveStale`, `DrainAdopt` |
| [realtime-durability-batches.ts](../../../apps/node-services/src/document/realtime-durability-batches.ts) (`createImmutableMutationBatch`)                                                                                                                         | Snapshots pending mutations onto `durableDocument` as `baseSeq + 1`                                                           | `DrainStart` (`batchBaseSeq`, `batchEdits`, `batchPending`)                                                   |
| [document-changes.ts](../../../apps/node-services/src/document/document-changes.ts) (`DocumentChangeCoordinator.apply`, `#readBase`, `#publish`)                                                                                                                   | Serializes via `DocumentOrderingQueue`, checks `findOperation`, settles append if open, saves CAS, broadcasts external update | `ChangeStartFindOp`, `ChangeReadBase`, `ChangeSaveCommit`, `ChangeSaveLostReply`, `ChangeSaveStale`           |
| [bodies.ts](../../../apps/node-services/src/document/bodies.ts) (`documentBodyStore`: `load`, `save`, `findOperation`)                                                                                                                                             | Enforces `WHERE seq = baseSeq`, recovers lost-reply identical saves at `baseSeq + 1`, persists `server_operations`            | `dbSeq`, `dbEdits`, `opRecorded`, `opSavedSeq`                                                                |

## When a Change Touches Covered Code

1. **Check for covered changes.** Run `git diff df68b59ccff3a4c99a8026e1a628510250b41663..HEAD -- apps/node-services/src/document/` and check whether any covered function moved, split, or gained new callers writing `document_bodies` or `DocumentDurabilityCoordinator`.
2. **Run the current check first.** Run `node .agents/skills/document-durability/scripts/check.mjs` (uses TLC v1.7.4; first run caches `tla2tools-1.7.4.jar` verified by SHA-256 under `~/.cache/linger-formal-verification/`).
3. **Update the model from the code.** Keep each synchronous TypeScript turn between `await` points as one TLA+ action in [DocumentDurability.tla](./DocumentDurability.tla). Update actions from the diff before re-running; never weaken `CommittedEditsPreserved` or `ResidentHasAppliedChange` to hide a failure.
4. **Read every result with `/statechart`.** Run `/statechart` against [DocumentDurability.tla](./DocumentDurability.tla) and [DocumentDurability.cfg](./DocumentDurability.cfg) in a scratch directory outside the repo to inspect the state graph and shortest path to any rule break.
5. **Separate real bugs from modeling errors.** Replay each counterexample step-by-step against `createDocumentRealtimeServer` and `MemoryDocumentBodies` (see [realtime-test-support.ts](../../../apps/node-services/tests/document/realtime-test-support.ts)) with:
   ```sh
   pnpm --filter @linger/node-services exec vitest run --project document <test-file>
   ```
   If any step in the trace cannot happen in the real code, fix the missing guard or granularity mismatch in [DocumentDurability.tla](./DocumentDurability.tla). If every step replays in TypeScript, the counterexample is a real bug.
6. **Prove the check can still fail.** For any invariant that passes on `HEAD`, temporarily inject the broken behavior it guards in a scratch edit to [DocumentDurability.tla](./DocumentDurability.tla) (for example, setting `ackedSeq'` and `ackedEdits'` in `DrainStart` to model calling `#onCommitted` before `await #saveUntilCommitted`, or removing the `dbSeq = batchBaseSeq` CAS guard from `DrainSaveSuccess`), re-run `check.mjs` to confirm the invariant goes red, and drop the scratch edit.
7. **Advance the sync commit.** Update the coverage table above and set `Sync commit` to `git rev-parse HEAD` only after confirming the model describes the current code and `check.mjs` reflects the true status of every rule.

## Baseline Finding at Sync Commit

At `df68b59ccff3a4c99a8026e1a628510250b41663` (present since `ff4bcd6e`), `ResidentHasAppliedChange` breaks along two real-code paths:

1. **Session open races an unopen server change (shortest 5-transition path):** `SessionOpenLoad` reads `seq = 0`; before `SessionOpenRegister` runs `durability.registerDocument`, `DocumentChangeCoordinator.apply` sees `!durability.hasDocument`, saves `seq = 1` with `s1`, skips `#publish`, and returns `applied` (`seq = 1`). `SessionOpenRegister` then registers the stale `seq = 0` snapshot as resident.
2. **Lost `bodies.save` reply on an open Document followed by retry (`findOperation`):** `DocumentChangeCoordinator.apply` writes `seq = 1` (`s1` + `operation_id`) to `document_bodies` while the Document is open at `resSeq = 0`, then throws before `#publish` (HTTP 503 retryable). Retry hits `bodies.findOperation`, immediately returning `applied` (`seq = 1`) without updating `durability` (`resSeq` stays `0`, never broadcasting `s1`).

## Bounds, Assumptions, and Out-of-Scope Code

- **Bounds**: One `ClientEdit` (`"c1"`), one `ServerEdit` (`"s1"`), `MaxAttempts = 2` for `DocumentChangeCoordinator.apply` (real code uses `maxAttempts = 3`), and abstract sequence numbers starting at `0`. Commuting Yjs updates are modeled as sets of edits rather than byte sequences.
- **Assumptions**: `document_bodies` CAS (`WHERE document_id = $1 AND seq = $2`) is atomic; the Document Runtime worker runs on one Node event-loop thread so code between `await` points is atomic.
- **Not covered**:
  - Single-subsystem liveness/stall detection: `NoDeadlock` checks global model deadlock only, and because `SessionOpenLoad`/`SessionOpenRegister` remain unconditionally enabled in every state, a wedged drain or stuck ordering lease alone does not trigger `CHECK_DEADLOCK`.
  - Ordering queue deadlines and timeout rejections (`mutationAuthorizationDeadlineMs` in `realtime-preflight.ts`/`realtime.ts`, `documentLoadDeadlineMs`, `changeDeadlineMs`).
  - `ConnectionDisconnects` revocation races across `await bodies.checkReferences` in `realtime-preflight.ts`, and connections that drop between `onAuthenticate` (`registerDocument`) and `onLoadDocument`/`afterUnloadDocument`.
  - Stale `SessionOpenLoad` snapshots racing a prior client save-and-unload (`Client 1` commits and releases the resident document while `Client 2` still holds an older loaded snapshot).
  - Yjs CRDT byte encoding, BlockNote schema validation, and `document-model` fingerprinting.
  - Permanent failure evidence (`failure-evidence.ts`), `RealtimeAdmissionController` limits, awareness, and History point idle/continuous timers in `bodies.ts`.
  - Cross-check drift after untouched commits: run `/maintain-formal-verification-skill` if covered files changed without updating this skill.
