----------------------- MODULE RunnerOperationLifecycle -----------------------
EXTENDS Integers, FiniteSets

CONSTANT MaxEpoch

VARIABLES
  connEpoch,
  connPhase,
  staleConnClosing,
  helloReportedActive,
  daemonBoot,
  daemonConnEpoch,
  daemonWelcomedEpochs,
  daemonLedger,
  daemonLedgerEpoch,
  daemonAcceptedPending,
  daemonTerminalPending,
  daemonExecCount,
  execAfterAccept,
  wireStartEpoch,
  gwOpState,
  gwOpAccepted,
  gwOpEpoch,
  gwOpPhase,
  opLeaseState,
  qActive,
  qSuspended,
  qActiveNonBg,
  qProbing,
  bgProbeActive,
  liveWaiter,
  liveWorkKilledByStaleDisconnect

vars == <<
  connEpoch, connPhase, staleConnClosing, helloReportedActive,
  daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
  daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
  daemonExecCount, execAfterAccept, wireStartEpoch,
  gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
  opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, bgProbeActive,
  liveWaiter, liveWorkKilledByStaleDisconnect
>>

Init ==
  /\ connEpoch = 0
  /\ connPhase = "offline"
  /\ staleConnClosing = FALSE
  /\ helloReportedActive = FALSE
  /\ daemonBoot = 1
  /\ daemonConnEpoch = 0
  /\ daemonWelcomedEpochs = {}
  /\ daemonLedger = "none"
  /\ daemonLedgerEpoch = 0
  /\ daemonAcceptedPending = FALSE
  /\ daemonTerminalPending = FALSE
  /\ daemonExecCount = 0
  /\ execAfterAccept = FALSE
  /\ wireStartEpoch = 0
  /\ gwOpState = "none"
  /\ gwOpAccepted = FALSE
  /\ gwOpEpoch = 0
  /\ gwOpPhase = "running"
  /\ opLeaseState = "none"
  /\ qActive = 0
  /\ qSuspended = 0
  /\ qActiveNonBg = 0
  /\ qProbing = FALSE
  /\ bgProbeActive = 0
  /\ liveWaiter = "none"
  /\ liveWorkKilledByStaleDisconnect = FALSE

(* Daemon.connectionHello -> RunnerConnections.#acceptConnectionInternal -> Daemon.acceptRunnerWelcome *)
ConnectFresh ==
  /\ connPhase = "offline"
  /\ connEpoch < MaxEpoch
  /\ LET nextEpoch == connEpoch + 1 IN
     /\ connEpoch' = nextEpoch
     /\ connPhase' = "reconciling"
     /\ helloReportedActive' = (daemonLedger = "running")
     /\ daemonConnEpoch' = nextEpoch
     /\ daemonWelcomedEpochs' = daemonWelcomedEpochs \cup {nextEpoch}
     /\ wireStartEpoch' = 0
  /\ UNCHANGED <<
       staleConnClosing, daemonBoot,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, bgProbeActive,
       liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* RunnerConnections.#replaceConnection installs a new socket, cleans up previous's in-flight calls, and closes previous.peer asynchronously *)
ReplaceConnection ==
  /\ connPhase \in {"reconciling", "ready"}
  /\ connEpoch < MaxEpoch
  /\ LET nextEpoch == connEpoch + 1
         afterActive == qActive - bgProbeActive
         admitWaiter == (bgProbeActive > 0 /\ liveWaiter = "waiting" /\ afterActive < 1)
     IN
     /\ connEpoch' = nextEpoch
     /\ connPhase' = "reconciling"
     /\ staleConnClosing' = TRUE
     /\ helloReportedActive' = (daemonLedger = "running")
     /\ daemonConnEpoch' = nextEpoch
     /\ daemonWelcomedEpochs' = daemonWelcomedEpochs \cup {nextEpoch}
     /\ wireStartEpoch' = 0
     /\ bgProbeActive' = 0
     /\ qProbing' = FALSE
     /\ IF admitWaiter
          THEN
            /\ liveWaiter' = "admitted"
            /\ qActive' = afterActive + 1
            /\ qActiveNonBg' = qActiveNonBg + 1
          ELSE
            /\ liveWaiter' = liveWaiter
            /\ qActive' = afterActive
            /\ qActiveNonBg' = qActiveNonBg
  /\ UNCHANGED <<
       daemonBoot,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qSuspended, liveWorkKilledByStaleDisconnect
     >>

(* RunnerOperations.completeOperationReconciliation + RunnerOperationState.reconnectCommands (keeps original connection_epoch immutable) *)
ReconcileComplete ==
  /\ connPhase = "reconciling"
  /\ connPhase' = "ready"
  /\ IF gwOpState = "running"
       THEN
         /\ gwOpEpoch' = gwOpEpoch
         /\ wireStartEpoch' = gwOpEpoch
       ELSE
         /\ gwOpEpoch' = gwOpEpoch
         /\ wireStartEpoch' = 0
  /\ UNCHANGED <<
       connEpoch, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept,
       gwOpState, gwOpAccepted, gwOpPhase,
       opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, bgProbeActive,
       liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* Current connection drops: RunnerConnections.disconnect(current) -> RunnerModelInvocation.rejectWaitersForComputer *)
ConnectionDrop ==
  /\ connPhase \in {"reconciling", "ready"}
  /\ connPhase' = "offline"
  /\ helloReportedActive' = FALSE
  /\ daemonConnEpoch' = 0
  /\ wireStartEpoch' = 0
  /\ qActive' = qActive - bgProbeActive
  /\ bgProbeActive' = 0
  /\ qProbing' = FALSE
  /\ liveWaiter' = IF liveWaiter = "waiting" THEN "none" ELSE liveWaiter
  /\ UNCHANGED <<
       connEpoch, staleConnClosing,
       daemonBoot, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qSuspended, qActiveNonBg, liveWorkKilledByStaleDisconnect
     >>

(* Delayed WebSocket close on superseded socket runs RunnerConnections.disconnect(previous), which cleans only previous-epoch waiters and returns when #connections.get(runnerId) /= previous *)
StaleDisconnectFires ==
  /\ staleConnClosing
  /\ staleConnClosing' = FALSE
  /\ UNCHANGED <<
       connEpoch, connPhase, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, bgProbeActive,
       liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* Daemon process crashes and restarts with an empty MemoryLedger and welcomedEpochs *)
DaemonCrashRestart ==
  /\ daemonBoot = 1
  /\ daemonBoot' = 2
  /\ daemonConnEpoch' = 0
  /\ daemonWelcomedEpochs' = {}
  /\ daemonLedger' = "none"
  /\ daemonLedgerEpoch' = 0
  /\ daemonAcceptedPending' = FALSE
  /\ daemonTerminalPending' = FALSE
  /\ wireStartEpoch' = 0
  /\ IF connPhase \in {"reconciling", "ready"}
       THEN
         /\ connPhase' = "offline"
         /\ helloReportedActive' = FALSE
         /\ qActive' = qActive - bgProbeActive
         /\ bgProbeActive' = 0
         /\ qProbing' = FALSE
         /\ liveWaiter' = IF liveWaiter = "waiting" THEN "none" ELSE liveWaiter
       ELSE
         UNCHANGED <<connPhase, helloReportedActive, qActive, bgProbeActive, qProbing, liveWaiter>>
  /\ UNCHANGED <<
       connEpoch, staleConnClosing,
       daemonExecCount, execAfterAccept,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qSuspended, qActiveNonBg, liveWorkKilledByStaleDisconnect
     >>

(* RunnerOperations.startOperation -> ModelQueue.acquire -> #startReservedOperation *)
GatewayStartOp ==
  /\ connPhase = "ready"
  /\ gwOpState = "none"
  /\ qActive < 1
  /\ gwOpState' = "running"
  /\ gwOpAccepted' = FALSE
  /\ gwOpEpoch' = connEpoch
  /\ gwOpPhase' = "running"
  /\ opLeaseState' = "active"
  /\ qActive' = qActive + 1
  /\ qActiveNonBg' = qActiveNonBg + 1
  /\ qProbing' = FALSE
  /\ wireStartEpoch' = connEpoch
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept,
       qSuspended, bgProbeActive, liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* Daemon.handleOperationStart -> MemoryLedger.Begin -> finishStaleEpochStart / startAcceptedOperation *)
DaemonHandleStart ==
  /\ wireStartEpoch /= 0
  /\ daemonConnEpoch = connEpoch
  /\ daemonConnEpoch /= 0
  /\ wireStartEpoch' = 0
  /\ IF daemonLedger /= "none"
       THEN
         (* Existing ledger record: identity conflict rejects replay; matching epoch replays retained frames *)
         UNCHANGED <<
           daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
           daemonExecCount, execAfterAccept
         >>
       ELSE IF wireStartEpoch /= daemonConnEpoch
       THEN
         (* finishStaleEpochStart: DAEMON_RESTARTED or EXECUTION_NOT_ADMITTED, never starts native turn *)
         /\ daemonLedger' = "terminal"
         /\ daemonLedgerEpoch' = wireStartEpoch
         /\ daemonTerminalPending' = TRUE
         /\ UNCHANGED <<daemonAcceptedPending, daemonExecCount, execAfterAccept>>
       ELSE
         (* Fresh admission: Append(operation.accepted) and launch startAcceptedOperation *)
         /\ daemonLedger' = "running"
         /\ daemonLedgerEpoch' = wireStartEpoch
         /\ daemonAcceptedPending' = TRUE
         /\ daemonExecCount' = daemonExecCount + 1
         /\ execAfterAccept' = (execAfterAccept \/ gwOpAccepted)
         /\ UNCHANGED <<daemonTerminalPending>>
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, bgProbeActive,
       liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* Daemon delivers operation.accepted -> RunnerOperations.receiveOperation -> RunnerOperationState.#acceptEnvelope *)
DeliverAccepted ==
  /\ connPhase \in {"reconciling", "ready"}
  /\ daemonConnEpoch = connEpoch
  /\ daemonAcceptedPending
  /\ daemonAcceptedPending' = FALSE
  /\ IF gwOpState = "running"
       THEN
         /\ gwOpAccepted' = TRUE
         /\ UNCHANGED <<gwOpState, opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, liveWaiter>>
       ELSE IF gwOpState = "terminal_retained"
       THEN
         (* Late frame arriving on receiveOperation sees operation.terminal and calls #retireOperation *)
         LET releasedActive == IF opLeaseState = "active" THEN 1 ELSE 0
             releasedSusp == IF opLeaseState = "suspended" THEN 1 ELSE 0
             afterActive == qActive - releasedActive
             afterSusp == qSuspended - releasedSusp
             afterNonBg == qActiveNonBg - releasedActive
             admitWaiter == (liveWaiter = "waiting" /\ afterActive < 1)
         IN
         /\ gwOpState' = "retired"
         /\ opLeaseState' = "none"
         /\ qSuspended' = afterSusp
         /\ IF admitWaiter
              THEN
                /\ liveWaiter' = "admitted"
                /\ qActive' = afterActive + 1
                /\ qActiveNonBg' = afterNonBg + 1
                /\ qProbing' = FALSE
              ELSE
                /\ liveWaiter' = liveWaiter
                /\ qActive' = afterActive
                /\ qActiveNonBg' = afterNonBg
                /\ qProbing' =
                     IF qProbing /\ afterNonBg = 0 /\ liveWaiter /= "waiting" /\ (afterActive > 0 \/ afterSusp > 0)
                       THEN TRUE
                       ELSE FALSE
         /\ UNCHANGED <<gwOpAccepted>>
       ELSE
         UNCHANGED <<gwOpState, gwOpAccepted, opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, liveWaiter>>
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpEpoch, gwOpPhase, bgProbeActive, liveWorkKilledByStaleDisconnect
     >>

(* Daemon.finishOperation commits terminal in MemoryLedger *)
DaemonCompleteOp ==
  /\ daemonLedger = "running"
  /\ daemonLedger' = "terminal"
  /\ daemonTerminalPending' = TRUE
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedgerEpoch, daemonAcceptedPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, bgProbeActive,
       liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* Daemon delivers terminal -> RunnerOperations.receiveOperation -> #retireOperation -> ModelLease.release *)
DeliverTerminal ==
  /\ connPhase \in {"reconciling", "ready"}
  /\ daemonConnEpoch = connEpoch
  /\ daemonTerminalPending
  /\ ~daemonAcceptedPending
  /\ daemonTerminalPending' = FALSE
  /\ IF gwOpState \in {"running", "terminal_retained"}
       THEN
         LET releasedActive == IF opLeaseState = "active" THEN 1 ELSE 0
             releasedSusp == IF opLeaseState = "suspended" THEN 1 ELSE 0
             afterActive == qActive - releasedActive
             afterSusp == qSuspended - releasedSusp
             afterNonBg == qActiveNonBg - releasedActive
             admitWaiter == (liveWaiter = "waiting" /\ afterActive < 1)
         IN
         /\ gwOpState' = "retired"
         /\ opLeaseState' = "none"
         /\ qSuspended' = afterSusp
         /\ IF admitWaiter
              THEN
                /\ liveWaiter' = "admitted"
                /\ qActive' = afterActive + 1
                /\ qActiveNonBg' = afterNonBg + 1
                /\ qProbing' = FALSE
              ELSE
                /\ liveWaiter' = liveWaiter
                /\ qActive' = afterActive
                /\ qActiveNonBg' = afterNonBg
                /\ qProbing' =
                     IF qProbing /\ afterNonBg = 0 /\ liveWaiter /= "waiting" /\ (afterActive > 0 \/ afterSusp > 0)
                       THEN TRUE
                       ELSE FALSE
       ELSE
         UNCHANGED <<gwOpState, opLeaseState, qActive, qSuspended, qActiveNonBg, qProbing, liveWaiter>>
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpAccepted, gwOpEpoch, gwOpPhase, bgProbeActive, liveWorkKilledByStaleDisconnect
     >>

(* Non-task RunnerOperationState.#cancel times out -> #complete -> #onSchedulingChange -> #retireOperation -> ModelLease.release *)
GatewayCancelTimeout ==
  /\ gwOpState = "running"
  /\ LET releasedActive == IF opLeaseState = "active" THEN 1 ELSE 0
         releasedSusp == IF opLeaseState = "suspended" THEN 1 ELSE 0
         afterActive == qActive - releasedActive
         afterSusp == qSuspended - releasedSusp
         afterNonBg == qActiveNonBg - releasedActive
         admitWaiter == (liveWaiter = "waiting" /\ afterActive < 1)
     IN
     /\ gwOpState' = "retired"
     /\ opLeaseState' = "none"
     /\ qSuspended' = afterSusp
     /\ IF admitWaiter
          THEN
            /\ liveWaiter' = "admitted"
            /\ qActive' = afterActive + 1
            /\ qActiveNonBg' = afterNonBg + 1
            /\ qProbing' = FALSE
          ELSE
            /\ liveWaiter' = liveWaiter
            /\ qActive' = afterActive
            /\ qActiveNonBg' = afterNonBg
            /\ qProbing' =
                 IF qProbing /\ afterNonBg = 0 /\ liveWaiter /= "waiting" /\ (afterActive > 0 \/ afterSusp > 0)
                   THEN TRUE
                   ELSE FALSE
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpAccepted, gwOpEpoch, gwOpPhase, bgProbeActive, liveWorkKilledByStaleDisconnect
     >>

(* run.background_waiting -> RunnerOperations.receiveOperation -> ModelLease.suspend -> ModelQueue.#drain *)
DeliverBgWaiting ==
  /\ connPhase \in {"reconciling", "ready"}
  /\ daemonConnEpoch = connEpoch
  /\ gwOpState = "running"
  /\ gwOpAccepted
  /\ daemonLedger = "running"
  /\ gwOpPhase = "running"
  /\ opLeaseState = "active"
  /\ gwOpPhase' = "waiting_background"
  /\ opLeaseState' = "suspended"
  /\ qSuspended' = qSuspended + 1
  /\ LET afterActive == qActive - 1
         afterNonBg == qActiveNonBg - 1
         admitWaiter == (liveWaiter = "waiting" /\ afterActive < 1)
     IN
     IF admitWaiter
       THEN
         /\ liveWaiter' = "admitted"
         /\ qActive' = afterActive + 1
         /\ qActiveNonBg' = afterNonBg + 1
         /\ qProbing' = FALSE
       ELSE
         /\ liveWaiter' = liveWaiter
         /\ qActive' = afterActive
         /\ qActiveNonBg' = afterNonBg
         /\ qProbing' = qProbing
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, bgProbeActive, liveWorkKilledByStaleDisconnect
     >>

(* run.background_resumed -> RunnerOperations.receiveOperation -> ModelLease.resume -> #drain (aborts active background probe) *)
DeliverBgResumed ==
  /\ connPhase \in {"reconciling", "ready"}
  /\ daemonConnEpoch = connEpoch
  /\ gwOpState = "running"
  /\ gwOpAccepted
  /\ daemonLedger = "running"
  /\ gwOpPhase = "waiting_background"
  /\ opLeaseState = "suspended"
  /\ gwOpPhase' = "running"
  /\ opLeaseState' = "active"
  /\ qSuspended' = qSuspended - 1
  /\ qActive' = qActive + 1
  /\ qActiveNonBg' = qActiveNonBg + 1
  /\ qProbing' = FALSE
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, bgProbeActive,
       liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* ModelQueue.#drain starts silent background concurrency probe (confirmed=1 -> probing=2) when backgroundOnly *)
StartBackgroundProbe ==
  /\ connPhase = "ready"
  /\ ~qProbing
  /\ qActiveNonBg = 0
  /\ liveWaiter /= "waiting"
  /\ bgProbeActive = 0
  /\ qProbing' = TRUE
  /\ bgProbeActive' = 2
  /\ qActive' = qActive + 2
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qSuspended, qActiveNonBg, liveWaiter, liveWorkKilledByStaleDisconnect
     >>

(* One background model_invoke completes -> ModelLease.release -> #drain / #prune *)
FinishBackgroundProbe ==
  /\ bgProbeActive > 0
  /\ LET afterBg == bgProbeActive - 1
         afterActive == qActive - 1
         admitWaiter == (liveWaiter = "waiting" /\ afterActive < 1)
     IN
     /\ bgProbeActive' = afterBg
     /\ IF admitWaiter
          THEN
            /\ liveWaiter' = "admitted"
            /\ qActive' = afterActive + 1
            /\ qActiveNonBg' = qActiveNonBg + 1
            /\ qProbing' = FALSE
          ELSE
            /\ liveWaiter' = liveWaiter
            /\ qActive' = afterActive
            /\ qActiveNonBg' = qActiveNonBg
            /\ qProbing' =
                 IF qProbing /\ qActiveNonBg = 0 /\ liveWaiter /= "waiting" /\ (afterActive > 0 \/ qSuspended > 0)
                   THEN TRUE
                   ELSE FALSE
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qSuspended, liveWorkKilledByStaleDisconnect
     >>

(* A second interactive Run queues on ModelQueue.acquire while the current connection is ready *)
QueueLiveWaiter ==
  /\ connPhase = "ready"
  /\ liveWaiter = "none"
  /\ gwOpState /= "none"
  /\ qProbing' = FALSE
  /\ IF qActive < 1
       THEN
         /\ liveWaiter' = "admitted"
         /\ qActive' = qActive + 1
         /\ qActiveNonBg' = qActiveNonBg + 1
       ELSE
         /\ liveWaiter' = "waiting"
         /\ qActive' = qActive
         /\ qActiveNonBg' = qActiveNonBg
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qSuspended, bgProbeActive, liveWorkKilledByStaleDisconnect
     >>

(* The admitted second interactive Run finishes and releases its ModelLease *)
ReleaseLiveWaiter ==
  /\ liveWaiter = "admitted"
  /\ LET afterActive == qActive - 1
         afterNonBg == qActiveNonBg - 1
     IN
     /\ liveWaiter' = "none"
     /\ qActive' = afterActive
     /\ qActiveNonBg' = afterNonBg
     /\ qProbing' =
          IF qProbing /\ afterNonBg = 0 /\ (afterActive > 0 \/ qSuspended > 0)
            THEN TRUE
            ELSE FALSE
  /\ UNCHANGED <<
       connEpoch, connPhase, staleConnClosing, helloReportedActive,
       daemonBoot, daemonConnEpoch, daemonWelcomedEpochs,
       daemonLedger, daemonLedgerEpoch, daemonAcceptedPending, daemonTerminalPending,
       daemonExecCount, execAfterAccept, wireStartEpoch,
       gwOpState, gwOpAccepted, gwOpEpoch, gwOpPhase,
       opLeaseState, qSuspended, bgProbeActive, liveWorkKilledByStaleDisconnect
     >>

(* Settled end state: no operation or waiter is stuck; protocol may idle *)
Quiescent ==
  /\ gwOpState \in {"none", "retired"}
  /\ liveWaiter = "none"
  /\ bgProbeActive = 0
  /\ wireStartEpoch = 0
  /\ ~staleConnClosing
  /\ daemonLedger /= "running"
  /\ (connPhase = "ready" => (~daemonAcceptedPending /\ ~daemonTerminalPending))
  /\ connPhase \in {"offline", "ready"}
  /\ UNCHANGED vars

Next ==
  \/ ConnectFresh
  \/ ReplaceConnection
  \/ ReconcileComplete
  \/ ConnectionDrop
  \/ StaleDisconnectFires
  \/ DaemonCrashRestart
  \/ GatewayStartOp
  \/ DaemonHandleStart
  \/ DeliverAccepted
  \/ DaemonCompleteOp
  \/ DeliverTerminal
  \/ GatewayCancelTimeout
  \/ DeliverBgWaiting
  \/ DeliverBgResumed
  \/ StartBackgroundProbe
  \/ FinishBackgroundProbe
  \/ QueueLiveWaiter
  \/ ReleaseLiveWaiter
  \/ Quiescent

Spec == Init /\ [][Next]_vars

(* ModelQueue counters always equal the exact sum of active and suspended leases *)
LeaseCountersConsistent ==
  /\ qActive = (IF opLeaseState = "active" THEN 1 ELSE 0)
               + bgProbeActive
               + (IF liveWaiter = "admitted" THEN 1 ELSE 0)
  /\ qSuspended = (IF opLeaseState = "suspended" THEN 1 ELSE 0)
  /\ qActiveNonBg = (IF opLeaseState = "active" THEN 1 ELSE 0)
                    + (IF liveWaiter = "admitted" THEN 1 ELSE 0)
  /\ qActive >= 0 /\ qSuspended >= 0 /\ qActiveNonBg >= 0

(* Once Gateway has received operation.accepted, neither reconnect replay nor Daemon restart re-executes op1 *)
NoExecutionAfterAcceptance ==
  ~execAfterAccept

(* Across all reconnects and Daemon crashes, one operation_id launches native execution at most once *)
AtMostOneNativeExecution ==
  daemonExecCount <= 1

(* Any Operation marked terminal on the Gateway has released its ModelQueue lease *)
TerminalOperationReleasesLease ==
  (gwOpState \in {"terminal_retained", "retired"}) => (opLeaseState = "none")

(* Closing a replaced WebSocket never rejects waiters or kills in-flight calls on the live replacement connection *)
ReplacementConnectionIsolated ==
  ~liveWorkKilledByStaleDisconnect

(* Silent background concurrency probing never runs while non-background work holds an active slot *)
ProbeIsolation ==
  qProbing => (qActiveNonBg = 0)

=============================================================================
