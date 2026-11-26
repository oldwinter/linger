---
name: runner-operation-lifecycle
description: "Formal TLA+ model check for cross-process Runner Gateway Operation lifecycle, reconnect/restart reconciliation, and ModelQueue lease/probe isolation across apps/node-services/src/agent/runner-gateway/ and apps/computer/local-daemon/internal/daemon/. Use when editing runner-operation.ts, runner-operations.ts, runner-connections.ts, runner-model-invocation.ts, model-queue.ts, adaptive-limit.ts, connection.go, operation_start.go, operation_ledger.go, or operations.go, or when changing how operation starts, cancels, reconnects, Daemon restarts, or waiting_background leases interact."
---

# Runner Operation Lifecycle Verification

Model-checks every interleaving across WebSocket frames, connection replacement, Daemon crashes/restarts, cancel timeouts, and `ModelQueue` lease/probe transitions between the Agent Service Runner Gateway (`apps/node-services/src/agent/runner-gateway/`) and the Local Computer Daemon (`apps/computer/local-daemon/internal/daemon/`).

- **Sync commit**: `fd48f3bd9ecbe888c01fc64fc65ea428553a7ecf`
- **Baseline outcome at sync commit**: `LeaseCountersConsistent` **PASS**, `NoExecutionAfterAcceptance` **PASS**, `NoDeadlock` **FAIL**, `AtMostOneNativeExecution` **FAIL**, `TerminalOperationReleasesLease` **FAIL**, `ReplacementConnectionIsolated` **FAIL**, `ProbeIsolation` **FAIL** (all five failures are real-code bugs confirmed by TypeScript and Go replays; do not weaken any property or change product code unless fixing the bug is the task).
- **Check command**: `node .agents/skills/runner-operation-lifecycle/scripts/check.mjs`
- **Result presentation**: Read every check result with the `/statechart` skill so invariant violations appear as their shortest paths in plain words and passing checks render a statechart.

## Properties Checked

- **`LeaseCountersConsistent`** (`PASS` at sync commit): `ModelQueue`'s `active`, `suspended`, and `activeNonBackground` counters always equal the exact sum of active and suspended leases held by Operations, background calls, and admitted waiters.
  - **Harm prevented**: Counter drift undercounts or overcounts slots, either starving an idle endpoint or admitting unbounded concurrent load.
- **`NoExecutionAfterAcceptance`** (`PASS` at sync commit): Once the Gateway has received `operation.accepted`, neither reconnect replay nor Daemon crash/restart launches `startAcceptedOperation` a second time for that `operation_id`.
  - **Harm prevented**: A confirmed Agent turn re-executes native shell commands, file writes, or tool calls after a reconnect or Daemon restart.
- **`AtMostOneNativeExecution`** (`FAIL` at sync commit): Across all reconnects and Daemon crashes, one `operation_id` launches native provider execution (`startAcceptedOperation`) at most once, even if the Daemon crashes before `operation.accepted` reaches the Gateway.
  - **Harm prevented**: A single Agent Run runs irreversible local side effects on the user's Computer twice.
- **`TerminalOperationReleasesLease`** (`FAIL` at sync commit): Whenever the Gateway marks an Operation terminal (`#terminal = true`), it retires the Operation and releases its `ModelQueue` lease.
  - **Harm prevented**: A leaked lease permanently deadlocks a single-slot (`concurrency = 1`) Computer endpoint until the Agent Service restarts.
- **`NoDeadlock`** (`CHECK_DEADLOCK TRUE`, `FAIL` at sync commit): Every reachable protocol state can eventually progress to a settled quiescent state with no wedged Operation or permanently blocked waiter.
  - **Harm prevented**: An unretired terminal Operation strands the Gateway and endpoint with no remaining event able to clear it.
- **`ReplacementConnectionIsolated`** (`FAIL` at sync commit): Closing a superseded WebSocket (`disconnect(previous)`) never rejects `ModelQueue` waiters or aborts in-flight `model_invoke` calls running on the live replacement connection.
  - **Harm prevented**: A routine reconnect whose old socket closes asynchronously fails live queued Runs and background model calls with `LocalComputerOfflineError`.
- **`ProbeIsolation`** (`FAIL` at sync commit): Silent background concurrency probing (`AdaptiveLimit.probing`) runs only while zero non-background Runs hold an active model slot (`activeNonBackground = 0`).
  - **Harm prevented**: Unconfirmed background probe concurrency runs alongside a live foreground Run, degrading user response latency and corrupting latency baselines.

## Coverage Record

| Source file and functions                                                                                                                                                                                                                   | Role in protocol                                                                                                                                                          | Model counterpart in [RunnerOperationLifecycle.tla](./RunnerOperationLifecycle.tla)                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [runner-connections.ts](../../../apps/node-services/src/agent/runner-gateway/runner-connections.ts) (`#acceptConnectionInternal`, `#replaceConnection`, `disconnect`)                                                                       | Increments `connectionEpoch`, replaces active socket while closing `previous`, clears/rejects waiters on `disconnect`                                                     | `ConnectFresh`, `ReplaceConnection`, `ConnectionDrop`, `StaleDisconnectFires`                                                                     |
| [runner-operations.ts](../../../apps/node-services/src/agent/runner-gateway/runner-operations.ts) (`startOperation`, `#startReservedOperation`, `completeOperationReconciliation`, `receiveOperation`, `#retireOperation`, `#releaseLease`) | Acquires `ModelLease`, dispatches `operation.start`, reconciles retained Operations on reconnect, suspends/resumes leases on background wait, retires terminal Operations | `GatewayStartOp`, `ReconcileComplete`, `DeliverAccepted`, `DeliverTerminal`, `DeliverBgWaiting`, `DeliverBgResumed`                               |
| [runner-operation.ts](../../../apps/node-services/src/agent/runner-gateway/runner-operation.ts) (`reconnectCommands`, `#rebaseConnectionEpoch`, `#receive`, `#acceptEnvelope`, `#applyEnvelope`, `#cancel`, `#complete`)                    | Tracks `#accepted`/`#terminal`/`#phase`, rebases unaccepted starts on reconnect, handles non-task cancel timeout locally without `#onSchedulingChange`                    | `ReconcileComplete`, `DeliverAccepted`, `DeliverTerminal`, `GatewayCancelTimeout`, `DeliverBgWaiting`, `DeliverBgResumed`                         |
| [runner-model-invocation.ts](../../../apps/node-services/src/agent/runner-gateway/runner-model-invocation.ts) (`invokeModel`, `receiveModelInvoked`, `rejectWaitersForComputer`)                                                            | Holds `ModelQueue` leases for background `model_invoke` calls; `rejectWaitersForComputer` aborts in-flight calls and calls `ModelQueue.rejectWaiters`                     | `StartBackgroundProbe`, `FinishBackgroundProbe`, `ConnectionDrop`, `StaleDisconnectFires`                                                         |
| [model-queue.ts](../../../apps/node-services/src/agent/runner-gateway/model-queue.ts) (`acquire`, `rejectWaiters`, `#lease.{suspend,resume,release}`, `#drain`, `#prune`)                                                                   | Tracks `active`, `suspended`, `activeNonBackground`, starts/aborts background probes in `#drain`, bypasses `#drain` in `resume()`                                         | `GatewayStartOp`, `DeliverBgWaiting`, `DeliverBgResumed`, `StartBackgroundProbe`, `FinishBackgroundProbe`, `QueueLiveWaiter`, `ReleaseLiveWaiter` |
| [adaptive-limit.ts](../../../apps/node-services/src/agent/runner-gateway/adaptive-limit.ts) (`startProbe`, `abortProbe`)                                                                                                                    | Tracks active silent background concurrency probe (`#probing`)                                                                                                            | `qProbing` in `StartBackgroundProbe`, `FinishBackgroundProbe`, `#drain` / `#prune` transitions                                                    |
| [connection.go](../../../apps/computer/local-daemon/internal/daemon/connection.go) (`connectionHello`, `acceptRunnerWelcome`, `recordWelcomedEpoch`)                                                                                        | Sends `active_operations` in `runner.hello`, records welcomed `connectionEpoch` in memory                                                                                 | `ConnectFresh`, `ReplaceConnection`, `DaemonCrashRestart`                                                                                         |
| [operation_start.go](../../../apps/computer/local-daemon/internal/daemon/operation_start.go) (`handleOperationStart`, `finishStaleEpochStart`)                                                                                              | Checks `MemoryLedger.Begin`, guards stale epochs against `d.connectionEpoch`, emits `DAEMON_RESTARTED` or launches `startAcceptedOperation`                               | `DaemonHandleStart`                                                                                                                               |
| [operation_ledger.go](../../../apps/computer/local-daemon/internal/daemon/operation_ledger.go) (`NewMemoryLedger`, `Begin`, `Append`, `Complete`, `Interrupt`, `Active`)                                                                    | Volatile per-process Operation ledger lost on Daemon crash/restart                                                                                                        | `daemonLedger`, `daemonLedgerEpoch`, `DaemonCrashRestart`, `DaemonHandleStart`                                                                    |
| [operations.go](../../../apps/computer/local-daemon/internal/daemon/operations.go) (`finishOperation`)                                                                                                                                      | Commits terminal event in `MemoryLedger` and delivers it to Gateway                                                                                                       | `DaemonCompleteOp`, `DeliverTerminal`                                                                                                             |

## When a Change Touches Covered Code

1. **Check whether your diff touches covered files.** Run:
   ```sh
   git diff fd48f3bd9ecbe888c01fc64fc65ea428553a7ecf..HEAD -- \
     apps/node-services/src/agent/runner-gateway/ \
     apps/computer/local-daemon/internal/daemon/
   ```
   Also check whether any new caller acquires or releases `ModelQueue` leases, retires `RunnerOperationState`, or changes Daemon epoch/incarnation admission.
2. **Run the current check first.** Run `node .agents/skills/runner-operation-lifecycle/scripts/check.mjs`. It runs TLC v1.7.4 (cached and SHA-256 verified under `~/.cache/linger-formal-verification/`) across all six invariants and `NoDeadlock` in a few seconds.
3. **Update the model to match the code.** Keep each indivisible JS event-loop turn or Go locked section as one TLA+ action in [RunnerOperationLifecycle.tla](./RunnerOperationLifecycle.tla). Never weaken an invariant to hide a failure.
4. **Read every result with `/statechart`.** Run `/statechart` on [RunnerOperationLifecycle.tla](./RunnerOperationLifecycle.tla) and [RunnerOperationLifecycle.cfg](./RunnerOperationLifecycle.cfg) in a scratch directory outside the repo to inspect the state graph and shortest plain-English path to each failure.
5. **Separate real bugs from modeling errors.** Replay any new counterexample step-by-step against the real code:
   - Gateway and `ModelQueue` paths: `createTestRunnerGateway` and `ModelQueue` in `apps/node-services/tests/agent/runner-gateway/`:
     ```sh
     pnpm --filter @linger/node-services exec vitest run <test-file>
     ```
   - Daemon admission and ledger paths: `acceptedStartDaemon` / `Daemon.handleOperationStart` in `apps/computer/local-daemon/internal/daemon/`:
     ```sh
     cd apps/computer/local-daemon && go test -v ./internal/daemon -run <TestName>
     ```
     If any step in the trace cannot occur in real TypeScript or Go, fix the missing guard or granularity mismatch in [RunnerOperationLifecycle.tla](./RunnerOperationLifecycle.tla). If every step replays, it is a real bug.
6. **Prove passing checks can still fail.** For each invariant that passes on `HEAD`, verify in a temporary scratch mutation that breaking the real guard it protects (for example, omitting `if (suspended)` in `ModelQueue.#lease`'s `finish()` for `LeaseCountersConsistent`, or dropping the `command.ConnectionEpoch != d.connectionEpoch` check in `operation_start.go` / `!this.#accepted` check in `runner-operation.ts` for `NoExecutionAfterAcceptance`) turns that invariant red, then revert the scratch edit and confirm the baseline results return.
7. **Advance the sync commit.** Update the Coverage Record, Baseline Outcome, and `Sync commit` (`git rev-parse HEAD`) only after confirming the model accurately describes the code at the new commit and `check.mjs` reflects the true status of every rule.

## Baseline Findings at Sync Commit

At `fd48f3bd9ecbe888c01fc64fc65ea428553a7ecf`, every failing property corresponds to a confirmed real-code bug replayed against TypeScript (`RunnerGateway` / `ModelQueue`) and Go (`Daemon`):

1. **Duplicate native execution across Daemon crash (`AtMostOneNativeExecution`, 8 transitions):**
   The Gateway starts an Operation on epoch 1; Daemon 1 admits it in `MemoryLedger` and starts native execution, then crashes before `operation.accepted` reaches the Gateway. Restarted Daemon 2 boots with an empty `MemoryLedger`, connects with `active_operations: []`, and receives `runner.welcome` at epoch 2. During `completeOperationReconciliation`, `RunnerOperationState.reconnectCommands` sees `!#accepted && !retainedByDaemon`, calls `#rebaseConnectionEpoch(2)`, and resends `operation.start` with `connection_epoch = 2`. Daemon 2 checks `command.ConnectionEpoch != d.connectionEpoch` (`2 == 2`), bypassing `finishStaleEpochStart` (`DAEMON_RESTARTED`), and executes the same `operation_id` a second time.
2. **Non-task cancel timeout permanently leaks `ModelQueue` lease and wedges endpoint (`TerminalOperationReleasesLease` in 4 transitions; `NoDeadlock` in 7 transitions):**
   The Gateway starts a non-task Run (`!#delegatedTask`, e.g., Room chat), acquiring a `ModelQueue` slot. When cancellation times out (`RunnerOperationState.#cancel`), it calls `this.#complete(...)` without calling `this.#onSchedulingChange?.()`, leaving the terminal Operation inside `#operations` and its lease unreleased in `#leases`. On reconnect, `completeOperationReconciliation` checks `if (!wasTerminal && operation.terminal)` — which is false — so the lease is never released unless a late Daemon frame arrives on `receiveOperation`, permanently deadlocking a single-slot (`concurrency = 1`) endpoint.
3. **Delayed `disconnect` of replaced socket kills live work on the replacement connection (`ReplacementConnectionIsolated`, 5 transitions):**
   Connection 1 is replaced by connection 2 via `#replaceConnection`, which closes connection 1's peer asynchronously while connection 2 becomes `ready` and queues a `ModelQueue` waiter or starts a `model_invoke` call. When connection 1's delayed `close` event runs `RunnerConnections.disconnect(previous)`, it skips the current-connection block but unconditionally invokes `modelInvocation().rejectWaitersForComputer(runnerId)` (and sibling `runnerId`-keyed waiter rejectors), aborting live in-flight calls and rejecting live `ModelQueue` waiters on connection 2 with `LocalComputerOfflineError`.
4. **Resuming from `waiting_background` runs foreground alongside an active background probe (`ProbeIsolation`, 8 transitions):**
   An accepted foreground Run enters `waiting_background` (`lease.suspend()`), dropping `activeNonBackground` to `0` so `ModelQueue.#drain` starts a silent background probe (`probing = 2`) with two background calls active. When `run.background_resumed` arrives, `lease.resume()` increments `active` and `activeNonBackground` without calling `#drain` or `limit.abortProbe()`, leaving `probing = 2` active while the foreground Run executes concurrently at `active = 3`.

## Bounds, Assumptions, and Out-of-Scope Code

- **Bounds**: One Computer (`runnerId`), one single-slot `ModelEndpoint` (`confirmed = 1`, silent probe target `2`), one primary non-task Operation (`op1`), one concurrent interactive waiter (`liveWaiter`), at most two active background `model_invoke` calls, `MaxEpoch = 2` connection epochs, and at most one Daemon crash/restart (`daemonBoot \in {1, 2}`). Exhaustive state space: 4,616 distinct states.
- **Assumptions**: Each Gateway event-loop turn between `await` points is atomic; Daemon `admissionMu`/`activeMu`/`MemoryLedger.mu` preserve atomicity of `handleOperationStart` and `finishOperation`; a Daemon restart clears volatile `MemoryLedger` and `welcomedEpochs` while retaining its on-disk `DaemonID`.
- **Not covered**:
  - Delegated task stop grace timers (`#boundStoppedTask`, `stoppedTaskGraceMs`), yield eligibility (`yieldBlocker` / `yieldLowerRun` picking a suspended `waiting_background` Run), and `ModelLease.borrow()` for tool approvals.
  - Operation inputs/steers (`operation.input`, `operation.input_result`, closed-input receipts, `expireInputReceipts`).
  - `operation.prepare`, `provider.prepare`, session compaction, MCP proxy cleanup (`uncleanOperations`), and `MAX_UNACCEPTED_START_RESENDS` (3) exhaustion across 3+ epochs.
  - `AdaptiveLimit` numeric latency ratios, cooldown timers, and multi-endpoint (`subscription` / `N >= 2`) ceilings.
  - TeamHub PostgreSQL `agent_local_runs` state and `RunLoop` / `ContextExecutor` above the Gateway.
  - Drift after untouched commits: run `/maintain-formal-verification-skill` if covered files changed without updating this skill.
