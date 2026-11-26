---
name: runner-operation-lifecycle
description: "Formal TLA+ model check for cross-process Runner Gateway Operation lifecycle, reconnect/restart reconciliation, and ModelQueue lease/probe isolation across apps/node-services/src/agent/runner-gateway/ and apps/computer/local-daemon/internal/daemon/. Use when editing runner-operation.ts, runner-operations.ts, runner-connections.ts, runner-model-invocation.ts, model-queue.ts, adaptive-limit.ts, connection.go, operation_start.go, operation_ledger.go, or operations.go, or when changing how operation starts, cancels, reconnects, Daemon restarts, or waiting_background leases interact."
---

# Runner Operation Lifecycle Verification

Model-checks every interleaving across WebSocket frames, connection replacement, Daemon crashes/restarts, cancel timeouts, and `ModelQueue` lease/probe transitions between the Agent Service Runner Gateway (`apps/node-services/src/agent/runner-gateway/`) and the Local Computer Daemon (`apps/computer/local-daemon/internal/daemon/`).

- **Sync commit**: `32fa4ce7f14d1d66e0f13bfb32e9242f2ea12f86`
- **Baseline outcome at sync commit**: `NoDeadlock` **PASS**, `LeaseCountersConsistent` **PASS**, `NoExecutionAfterAcceptance` **PASS**, `AtMostOneNativeExecution` **PASS**, `TerminalOperationReleasesLease` **PASS**, `ReplacementConnectionIsolated` **PASS**, `ProbeIsolation` **PASS** (3,243 distinct states, 14,279 generated; every invariant verified non-vacuous by guard-removal mutation checks).
- **Check command**: `node .agents/skills/runner-operation-lifecycle/scripts/check.mjs`
- **Result presentation**: Read every check result with the `/statechart` skill so invariant violations appear as their shortest paths in plain words and passing checks render a statechart.

## Properties Checked

- **`LeaseCountersConsistent`** (`PASS` at sync commit): `ModelQueue`'s `active`, `suspended`, and `activeNonBackground` counters always equal the exact sum of active and suspended leases held by Operations, background calls, and admitted waiters.
  - **Harm prevented**: Counter drift undercounts or overcounts slots, either starving an idle endpoint or admitting unbounded concurrent load.
- **`NoExecutionAfterAcceptance`** (`PASS` at sync commit): Once the Gateway has received `operation.accepted`, neither reconnect replay nor Daemon crash/restart launches `startAcceptedOperation` a second time for that `operation_id`.
  - **Harm prevented**: A confirmed Agent turn re-executes native shell commands, file writes, or tool calls after a reconnect or Daemon restart.
- **`AtMostOneNativeExecution`** (`PASS` at sync commit): Across all reconnects and Daemon crashes, one `operation_id` launches native provider execution (`startAcceptedOperation`) at most once, even if the Daemon crashes before `operation.accepted` reaches the Gateway.
  - **Harm prevented**: A single Agent Run runs irreversible local side effects on the user's Computer twice.
- **`TerminalOperationReleasesLease`** (`PASS` at sync commit): Whenever the Gateway marks an Operation terminal (`#terminal = true`), it retires the Operation and releases its `ModelQueue` lease.
  - **Harm prevented**: A leaked lease permanently deadlocks a single-slot (`concurrency = 1`) Computer endpoint until the Agent Service restarts.
- **`NoDeadlock`** (`CHECK_DEADLOCK TRUE`, `PASS` at sync commit): Every reachable protocol state can eventually progress to a settled quiescent state with no wedged Operation or permanently blocked waiter.
  - **Harm prevented**: An unretired terminal Operation strands the Gateway and endpoint with no remaining event able to clear it.
- **`ReplacementConnectionIsolated`** (`PASS` at sync commit): Closing a superseded WebSocket (`disconnect(previous)`) never rejects `ModelQueue` waiters or aborts in-flight `model_invoke` calls running on the live replacement connection.
  - **Harm prevented**: A routine reconnect whose old socket closes asynchronously fails live queued Runs and background model calls with `LocalComputerOfflineError`.
- **`ProbeIsolation`** (`PASS` at sync commit): Silent background concurrency probing (`AdaptiveLimit.probing`) runs only while zero non-background Runs hold an active model slot (`activeNonBackground = 0`).
  - **Harm prevented**: Unconfirmed background probe concurrency runs alongside a live foreground Run, degrading user response latency and corrupting latency baselines.

## Coverage Record

| Source file and functions                                                                                                                                                                                                                   | Role in protocol                                                                                                                                                                | Model counterpart in [RunnerOperationLifecycle.tla](./RunnerOperationLifecycle.tla)                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [runner-connections.ts](../../../apps/node-services/src/agent/runner-gateway/runner-connections.ts) (`#acceptConnectionInternal`, `#replaceConnection`, `#cleanupConnectionWaiters`, `disconnect`)                                          | Increments `connectionEpoch`, cleans up superseded connection's waiters on replacement, guards `runnerId`-wide offline cleanup on `#connections.get(runnerId) === connection`   | `ConnectFresh`, `ReplaceConnection`, `ConnectionDrop`, `StaleDisconnectFires`                                                                     |
| [runner-operations.ts](../../../apps/node-services/src/agent/runner-gateway/runner-operations.ts) (`startOperation`, `#startReservedOperation`, `completeOperationReconciliation`, `receiveOperation`, `#retireOperation`, `#releaseLease`) | Acquires `ModelLease`, dispatches `operation.start`, reconciles retained Operations on reconnect, syncs lease suspend/resume on phase, retires every terminal Operation         | `GatewayStartOp`, `ReconcileComplete`, `DeliverAccepted`, `DeliverTerminal`, `DeliverBgWaiting`, `DeliverBgResumed`                               |
| [runner-operation.ts](../../../apps/node-services/src/agent/runner-gateway/runner-operation.ts) (`reconnectCommands`, `#receive`, `#acceptEnvelope`, `#applyEnvelope`, `#cancel`, `#complete`)                                              | Tracks `#accepted`/`#terminal`/`#phase`, keeps original `connection_epoch` immutable across reconnects, notifies `#onSchedulingChange` on non-task cancel timeout               | `ReconcileComplete`, `DeliverAccepted`, `DeliverTerminal`, `GatewayCancelTimeout`, `DeliverBgWaiting`, `DeliverBgResumed`                         |
| [runner-model-invocation.ts](../../../apps/node-services/src/agent/runner-gateway/runner-model-invocation.ts) (`invokeModel`, `receiveModelInvoked`, `rejectInFlightForConnection`, `rejectWaitersForComputer`)                             | Holds `ModelQueue` leases for background `model_invoke` calls; scopes replacement cleanup by connection epoch and rejects `ModelQueue` waiters only on current-connection drop  | `StartBackgroundProbe`, `FinishBackgroundProbe`, `ReplaceConnection`, `ConnectionDrop`, `StaleDisconnectFires`                                    |
| [model-queue.ts](../../../apps/node-services/src/agent/runner-gateway/model-queue.ts) (`acquire`, `rejectWaiters`, `#lease.{suspend,resume,release}`, `#drain`, `#prune`)                                                                   | Tracks `active`, `suspended`, `activeNonBackground`; calls `#drain` in `resume()` to abort active probes and requests yield of excess background calls                          | `GatewayStartOp`, `DeliverBgWaiting`, `DeliverBgResumed`, `StartBackgroundProbe`, `FinishBackgroundProbe`, `QueueLiveWaiter`, `ReleaseLiveWaiter` |
| [adaptive-limit.ts](../../../apps/node-services/src/agent/runner-gateway/adaptive-limit.ts) (`startProbe`, `abortProbe`)                                                                                                                    | Tracks active silent background concurrency probe (`#probing`)                                                                                                                  | `qProbing` in `StartBackgroundProbe`, `FinishBackgroundProbe`, `#drain` / `#prune` transitions                                                    |
| [connection.go](../../../apps/computer/local-daemon/internal/daemon/connection.go) (`connectionHello`, `acceptRunnerWelcome`, `recordWelcomedEpoch`)                                                                                        | Sends `active_operations` in `runner.hello`, records welcomed `connectionEpoch` in memory                                                                                       | `ConnectFresh`, `ReplaceConnection`, `DaemonCrashRestart`                                                                                         |
| [operation_start.go](../../../apps/computer/local-daemon/internal/daemon/operation_start.go) (`handleOperationStart`, `finishStaleEpochStart`)                                                                                              | Skips Context View sync for stale-epoch starts, checks `MemoryLedger.Begin`, guards stale epochs against `d.connectionEpoch`, emits `DAEMON_RESTARTED`/`EXECUTION_NOT_ADMITTED` | `DaemonHandleStart`                                                                                                                               |
| [operation_ledger.go](../../../apps/computer/local-daemon/internal/daemon/operation_ledger.go) (`NewMemoryLedger`, `Begin`, `Append`, `Complete`, `Interrupt`, `Active`)                                                                    | Volatile per-process Operation ledger lost on Daemon crash/restart                                                                                                              | `daemonLedger`, `daemonLedgerEpoch`, `DaemonCrashRestart`, `DaemonHandleStart`                                                                    |
| [operations.go](../../../apps/computer/local-daemon/internal/daemon/operations.go) (`finishOperation`)                                                                                                                                      | Commits terminal event in `MemoryLedger` and delivers it to Gateway                                                                                                             | `DaemonCompleteOp`, `DeliverTerminal`                                                                                                             |

## When a Change Touches Covered Code

1. **Check whether your diff touches covered files.** Run:
   ```sh
   git diff 32fa4ce7f14d1d66e0f13bfb32e9242f2ea12f86..HEAD -- \
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
6. **Prove passing checks can still fail.** For each invariant that passes on `HEAD`, verify in a temporary scratch mutation that breaking the real guard it protects (for example, omitting `if (suspended)` in `ModelQueue.#lease`'s `finish()` for `LeaseCountersConsistent`, rebasing `connection_epoch` on reconnect for `AtMostOneNativeExecution`, dropping `command.ConnectionEpoch != d.connectionEpoch` in `operation_start.go` for `NoExecutionAfterAcceptance`, omitting `#onSchedulingChange?.()` on cancel timeout for `TerminalOperationReleasesLease` and `NoDeadlock`, dropping the current-connection guard in `RunnerConnections.disconnect` for `ReplacementConnectionIsolated`, or omitting `#drain` / `abortProbe()` in `ModelLease.resume()` for `ProbeIsolation`) turns that invariant red, then revert the scratch edit and confirm all checks pass.
7. **Advance the sync commit.** Update the Coverage Record, Baseline Outcome, and `Sync commit` (`git rev-parse HEAD`) only after confirming the model accurately describes the code at the new commit and `check.mjs` reflects the true status of every rule.

## Baseline Findings at Sync Commit

At `32fa4ce7f14d1d66e0f13bfb32e9242f2ea12f86`, all six invariants and `NoDeadlock` pass with 0 violations across 3,243 distinct states (14,279 generated):

1. **Immutable `connection_epoch` across reconnects (`AtMostOneNativeExecution`, `NoExecutionAfterAcceptance`):**
   `RunnerOperationState.reconnectCommands` preserves the original `connection_epoch` of `this.start`. A surviving Daemon replays retained records matching that epoch or returns retryable `EXECUTION_NOT_ADMITTED` if it never admitted the start; a restarted Daemon with an empty `MemoryLedger` and `welcomedEpochs` hits `finishStaleEpochStart` and returns non-retryable `DAEMON_RESTARTED` without launching a second native turn.
2. **Immediate retirement on non-task cancel timeout (`TerminalOperationReleasesLease`, `NoDeadlock`):**
   `RunnerOperationState.#cancel` invokes `this.#onSchedulingChange?.()` after `#complete` on non-delegated-task timeout so `RunnerOperations.#retireOperation` deletes the Operation and releases its `ModelQueue` lease immediately, and `completeOperationReconciliation` retires any terminal Operation unconditionally.
3. **Connection-scoped waiter cleanup and current-connection guard (`ReplacementConnectionIsolated`):**
   `RunnerConnections.#replaceConnection` cleans up only the superseded connection's in-flight waiters (`#cleanupConnectionWaiters(previous)`), and `RunnerConnections.disconnect` returns after per-connection cleanup whenever `#connections.get(runnerId) !== connection`, isolating live `ModelQueue` waiters and in-flight calls on the replacement connection from delayed socket close events.
4. **Background probe abort on `waiting_background` resume (`ProbeIsolation`):**
   `ModelQueue.#lease`'s `resume()` runs `#drain(state)` to abort any active silent background probe (`limit.abortProbe()`) as soon as `activeNonBackground` rises above `0` and requests yield of excess background calls above the endpoint cap.

## Bounds, Assumptions, and Out-of-Scope Code

- **Bounds**: One Computer (`runnerId`), one single-slot `ModelEndpoint` (`confirmed = 1`, silent probe target `2`), one primary non-task Operation (`op1`), one concurrent interactive waiter (`liveWaiter`), at most two active background `model_invoke` calls, `MaxEpoch = 2` connection epochs, and at most one Daemon crash/restart (`daemonBoot \in {1, 2}`). Exhaustive state space: 3,243 distinct states.
- **Assumptions**: Each Gateway event-loop turn between `await` points is atomic; Daemon `admissionMu`/`activeMu`/`MemoryLedger.mu` preserve atomicity of `handleOperationStart` and `finishOperation`; a Daemon restart clears volatile `MemoryLedger` and `welcomedEpochs` while retaining its on-disk `DaemonID`.
- **Not covered**:
  - Delegated task stop grace timers (`#boundStoppedTask`, `stoppedTaskGraceMs`), yield eligibility (`yieldBlocker` / `yieldLowerRun` picking a suspended `waiting_background` Run), and `ModelLease.borrow()` for tool approvals.
  - Operation inputs/steers (`operation.input`, `operation.input_result`, closed-input receipts, `expireInputReceipts`).
  - `operation.prepare`, `provider.prepare`, session compaction, MCP proxy cleanup (`uncleanOperations`), and `MAX_UNACCEPTED_START_RESENDS` (3) exhaustion across 3+ epochs.
  - `AdaptiveLimit` numeric latency ratios, cooldown timers, and multi-endpoint (`subscription` / `N >= 2`) ceilings.
  - TeamHub PostgreSQL `agent_local_runs` state and `RunLoop` / `ContextExecutor` above the Gateway.
  - Drift after untouched commits: run `/maintain-formal-verification-skill` if covered files changed without updating this skill.
