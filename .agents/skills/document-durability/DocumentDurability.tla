------------------------- MODULE DocumentDurability -------------------------
EXTENDS Integers, FiniteSets

CONSTANT MaxAttempts

ClientEdit == "c1"
ServerEdit == "s1"
Edits == {ClientEdit, ServerEdit}

VARIABLES
  dbSeq,
  dbEdits,
  opRecorded,
  opSavedSeq,
  openingState,
  openLoadedSeq,
  openLoadedEdits,
  openWatchStale,
  hasOpenClient,
  resOpen,
  resSeq,
  resEdits,
  pending,
  clientEditUsed,
  drainPhase,
  batchBaseSeq,
  batchEdits,
  batchPending,
  orderingLocked,
  changePhase,
  changeAttempts,
  changeBaseSeq,
  changeBaseEdits,
  reconcileSeq,
  reconcileEdits,
  appliedSeq,
  appliedEdits,
  ackedSeq,
  ackedEdits

vars == <<
  dbSeq, dbEdits, opRecorded, opSavedSeq,
  openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
  resOpen, resSeq, resEdits, pending, clientEditUsed,
  drainPhase, batchBaseSeq, batchEdits, batchPending,
  orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
  reconcileSeq, reconcileEdits,
  appliedSeq, appliedEdits, ackedSeq, ackedEdits
>>

Init ==
  /\ dbSeq = 0
  /\ dbEdits = {}
  /\ opRecorded = FALSE
  /\ opSavedSeq = 0
  /\ openingState = "none"
  /\ openLoadedSeq = 0
  /\ openLoadedEdits = {}
  /\ openWatchStale = FALSE
  /\ hasOpenClient = FALSE
  /\ resOpen = FALSE
  /\ resSeq = 0
  /\ resEdits = {}
  /\ pending = {}
  /\ clientEditUsed = FALSE
  /\ drainPhase = "idle"
  /\ batchBaseSeq = 0
  /\ batchEdits = {}
  /\ batchPending = {}
  /\ orderingLocked = FALSE
  /\ changePhase = "idle"
  /\ changeAttempts = 0
  /\ changeBaseSeq = 0
  /\ changeBaseEdits = {}
  /\ reconcileSeq = 0
  /\ reconcileEdits = {}
  /\ appliedSeq = 0
  /\ appliedEdits = {}
  /\ ackedSeq = 0
  /\ ackedEdits = {}

(* DocumentSessionManager.open: durability.watchOpenBody + await bodies.load(documentId) *)
SessionOpenLoad ==
  /\ openingState = "none"
  /\ openingState' = "loaded"
  /\ openLoadedSeq' = dbSeq
  /\ openLoadedEdits' = dbEdits
  /\ openWatchStale' = FALSE
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       hasOpenClient, resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentSessionManager.open: warm registration when durability.hasDocument is already true *)
SessionOpenRegisterWarm ==
  /\ openingState = "loaded"
  /\ resOpen
  /\ openingState' = "none"
  /\ hasOpenClient' = TRUE
  /\ openLoadedSeq' = 0
  /\ openLoadedEdits' = {}
  /\ openWatchStale' = FALSE
  /\ IF drainPhase = "saving" /\ batchBaseSeq + 1 = openLoadedSeq /\ batchEdits = openLoadedEdits
       THEN
         /\ resSeq' = openLoadedSeq
         /\ resEdits' = openLoadedEdits
         /\ ackedSeq' = openLoadedSeq
         /\ ackedEdits' = openLoadedEdits
       ELSE IF openLoadedSeq > resSeq /\ drainPhase /= "saving"
       THEN
         /\ resSeq' = openLoadedSeq
         /\ resEdits' = openLoadedEdits
         /\ ackedSeq' = openLoadedSeq
         /\ ackedEdits' = openLoadedEdits
       ELSE
         /\ resSeq' = resSeq
         /\ resEdits' = resEdits
         /\ ackedSeq' = resSeq
         /\ ackedEdits' = resEdits
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       resOpen, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits
     >>

(* DocumentSessionManager.open: cold registration acquires ordering lease; if watch stayed clean, registers immediately *)
SessionOpenColdRegister ==
  /\ openingState = "loaded"
  /\ ~resOpen
  /\ ~orderingLocked
  /\ ~openWatchStale
  /\ openingState' = "none"
  /\ hasOpenClient' = TRUE
  /\ resOpen' = TRUE
  /\ resSeq' = openLoadedSeq
  /\ resEdits' = openLoadedEdits
  /\ ackedSeq' = openLoadedSeq
  /\ ackedEdits' = openLoadedEdits
  /\ openLoadedSeq' = 0
  /\ openLoadedEdits' = {}
  /\ openWatchStale' = FALSE
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits
     >>

(* DocumentSessionManager.open: cold registration saw a concurrent write/unload, holds ordering lease and starts reload *)
SessionOpenColdReloadStart ==
  /\ openingState = "loaded"
  /\ ~resOpen
  /\ ~orderingLocked
  /\ openWatchStale
  /\ orderingLocked' = TRUE
  /\ openingState' = "reloading"
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentSessionManager.open: await bodies.load while holding ordering lease *)
SessionOpenColdReloadLoad ==
  /\ openingState = "reloading"
  /\ openingState' = "reloaded"
  /\ openLoadedSeq' = dbSeq
  /\ openLoadedEdits' = dbEdits
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentSessionManager.open: register reloaded snapshot and release ordering lease *)
SessionOpenColdReloadRegister ==
  /\ openingState = "reloaded"
  /\ openingState' = "none"
  /\ orderingLocked' = FALSE
  /\ hasOpenClient' = TRUE
  /\ resOpen' = TRUE
  /\ resSeq' = openLoadedSeq
  /\ resEdits' = openLoadedEdits
  /\ ackedSeq' = openLoadedSeq
  /\ ackedEdits' = openLoadedEdits
  /\ openLoadedSeq' = 0
  /\ openLoadedEdits' = {}
  /\ openWatchStale' = FALSE
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits
     >>

(* Last connection disconnects after beforeUnloadDocument flushes pending mutations; releaseDocument notifies open watchers *)
SessionCloseUnload ==
  /\ hasOpenClient
  /\ resOpen
  /\ drainPhase = "idle"
  /\ pending = {}
  /\ hasOpenClient' = FALSE
  /\ resOpen' = FALSE
  /\ resSeq' = 0
  /\ resEdits' = {}
  /\ openWatchStale' = IF openingState = "loaded" THEN TRUE ELSE openWatchStale
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits,
       pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentMutationPreflight.authorizeSync -> DocumentDurabilityCoordinator.reserveMutation/recordAppliedMutation *)
ClientMutate ==
  /\ hasOpenClient
  /\ resOpen
  /\ ~orderingLocked
  /\ ~clientEditUsed
  /\ pending' = pending \cup {ClientEdit}
  /\ clientEditUsed' = TRUE
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentDurabilityCoordinator.#drain builds an ImmutableMutationBatch and starts bodies.save *)
DrainStart ==
  /\ resOpen
  /\ drainPhase = "idle"
  /\ pending /= {}
  /\ drainPhase' = "saving"
  /\ batchBaseSeq' = resSeq
  /\ batchPending' = pending
  /\ batchEdits' = resEdits \cup pending
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* bodies.save succeeds on baseSeq or recovers a lost-reply identical save; #drain commits resident head and sends durability_ack *)
DrainSaveSuccess ==
  /\ drainPhase = "saving"
  /\ (dbSeq = batchBaseSeq \/ (dbSeq = batchBaseSeq + 1 /\ dbEdits = batchEdits))
  /\ dbSeq' = batchBaseSeq + 1
  /\ dbEdits' = batchEdits
  /\ resSeq' = batchBaseSeq + 1
  /\ resEdits' = batchEdits
  /\ pending' = pending \ batchPending
  /\ ackedSeq' = batchBaseSeq + 1
  /\ ackedEdits' = batchEdits
  /\ drainPhase' = "idle"
  /\ batchBaseSeq' = 0
  /\ batchEdits' = {}
  /\ batchPending' = {}
  /\ UNCHANGED <<
       opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, clientEditUsed,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits
     >>

(* bodies.save commits UPDATE in PostgreSQL, then throws a transient error before returning to #saveUntilCommitted *)
DrainSaveLostReply ==
  /\ drainPhase = "saving"
  /\ dbSeq = batchBaseSeq
  /\ dbSeq' = batchBaseSeq + 1
  /\ dbEdits' = batchEdits
  /\ UNCHANGED <<
       opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* bodies.save sees a newer sequence from another writer, settles appendSettled, and enters #adoptSavedBody *)
DrainSaveStale ==
  /\ drainPhase = "saving"
  /\ dbSeq /= batchBaseSeq
  /\ ~(dbSeq = batchBaseSeq + 1 /\ dbEdits = batchEdits)
  /\ drainPhase' = "adopting"
  /\ batchEdits' = {}
  /\ batchPending' = {}
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       batchBaseSeq,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* #adoptSavedBody loads the newer DB row and adopts it when loaded.seq > queue.head.persisted_seq *)
DrainAdopt ==
  /\ drainPhase = "adopting"
  /\ dbSeq > batchBaseSeq
  /\ drainPhase' = "idle"
  /\ batchBaseSeq' = 0
  /\ IF resSeq < dbSeq
       THEN
         /\ resSeq' = dbSeq
         /\ resEdits' = dbEdits
         /\ ackedSeq' = dbSeq
         /\ ackedEdits' = dbEdits
       ELSE
         /\ resSeq' = resSeq
         /\ resEdits' = resEdits
         /\ ackedSeq' = ackedSeq
         /\ ackedEdits' = ackedEdits
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, pending, clientEditUsed,
       batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits
     >>

(* DocumentChangeCoordinator.apply acquires ordering lease and runs bodies.findOperation *)
ChangeStartFindOp ==
  /\ ~orderingLocked
  /\ \/ changePhase \in {"idle", "retryable_error"}
     \/ (changePhase = "retry_loop" /\ changeAttempts < MaxAttempts)
  /\ LET nextAttempt == IF changePhase = "retry_loop" THEN changeAttempts + 1 ELSE 1 IN
     IF opRecorded
       THEN
         IF resOpen /\ (drainPhase = "saving" \/ resSeq < opSavedSeq)
           THEN
             /\ orderingLocked' = TRUE
             /\ changePhase' = "reconciling_applied"
             /\ changeAttempts' = 0
             /\ UNCHANGED <<appliedSeq, appliedEdits>>
           ELSE
             /\ orderingLocked' = FALSE
             /\ changePhase' = "applied"
             /\ changeAttempts' = 0
             /\ appliedSeq' = opSavedSeq
             /\ appliedEdits' = appliedEdits \cup {ServerEdit}
       ELSE
         /\ orderingLocked' = TRUE
         /\ changePhase' = "read_base"
         /\ changeAttempts' = nextAttempt
         /\ UNCHANGED <<appliedSeq, appliedEdits>>
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changeBaseSeq, changeBaseEdits, reconcileSeq, reconcileEdits,
       ackedSeq, ackedEdits
     >>

(* DocumentChangeCoordinator.#reconcileResident for an earlier operation: waits for settleAppend, then checks seq or loads *)
ChangeReconcileAppliedLoad ==
  /\ changePhase = "reconciling_applied"
  /\ (resOpen => drainPhase /= "saving")
  /\ IF ~resOpen \/ resSeq >= opSavedSeq
       THEN
         /\ orderingLocked' = FALSE
         /\ changePhase' = "applied"
         /\ appliedSeq' = opSavedSeq
         /\ appliedEdits' = appliedEdits \cup {ServerEdit}
         /\ UNCHANGED <<reconcileSeq, reconcileEdits>>
       ELSE
         /\ orderingLocked' = TRUE
         /\ changePhase' = "reconciling_applied_loaded"
         /\ reconcileSeq' = dbSeq
         /\ reconcileEdits' = dbEdits
         /\ UNCHANGED <<appliedSeq, appliedEdits>>
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changeAttempts, changeBaseSeq, changeBaseEdits, ackedSeq, ackedEdits
     >>

(* reconcileSavedBody after bodies.load for an earlier operation: retries if a drain started, else adopts and returns applied *)
ChangeReconcileAppliedFinish ==
  /\ changePhase = "reconciling_applied_loaded"
  /\ IF resOpen /\ reconcileSeq > resSeq /\ drainPhase = "saving"
       THEN
         /\ orderingLocked' = TRUE
         /\ changePhase' = "reconciling_applied"
         /\ reconcileSeq' = 0
         /\ reconcileEdits' = {}
         /\ UNCHANGED <<resSeq, resEdits, ackedSeq, ackedEdits, appliedSeq, appliedEdits>>
       ELSE
         /\ orderingLocked' = FALSE
         /\ changePhase' = "applied"
         /\ appliedSeq' = opSavedSeq
         /\ appliedEdits' = appliedEdits \cup {ServerEdit}
         /\ reconcileSeq' = 0
         /\ reconcileEdits' = {}
         /\ IF resOpen /\ reconcileSeq > resSeq
              THEN
                /\ resSeq' = reconcileSeq
                /\ resEdits' = reconcileEdits
                /\ ackedSeq' = reconcileSeq
                /\ ackedEdits' = reconcileEdits
              ELSE
                /\ resSeq' = resSeq
                /\ resEdits' = resEdits
                /\ ackedSeq' = ackedSeq
                /\ ackedEdits' = ackedEdits
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changeAttempts, changeBaseSeq, changeBaseEdits
     >>

(* DocumentChangeCoordinator.#readBase waits for settleAppend when open, then captures resident or DB state *)
ChangeReadBase ==
  /\ changePhase = "read_base"
  /\ (resOpen => drainPhase /= "saving")
  /\ changeBaseSeq' = IF resOpen THEN resSeq ELSE dbSeq
  /\ changeBaseEdits' = IF resOpen THEN resEdits ELSE dbEdits
  /\ changePhase' = "saving"
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, openWatchStale, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changeAttempts, reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentChangeCoordinator.apply commits bodies.save, runs #publish, notifies open watchers, and releases ordering lease *)
ChangeSaveCommit ==
  /\ changePhase = "saving"
  /\ dbSeq = changeBaseSeq
  /\ dbSeq' = changeBaseSeq + 1
  /\ dbEdits' = changeBaseEdits \cup {ServerEdit}
  /\ opRecorded' = TRUE
  /\ opSavedSeq' = changeBaseSeq + 1
  /\ orderingLocked' = FALSE
  /\ changePhase' = "applied"
  /\ changeAttempts' = 0
  /\ appliedSeq' = changeBaseSeq + 1
  /\ appliedEdits' = appliedEdits \cup {ServerEdit}
  /\ changeBaseSeq' = 0
  /\ changeBaseEdits' = {}
  /\ openWatchStale' = IF openingState = "loaded" THEN TRUE ELSE openWatchStale
  /\ IF resOpen /\ resSeq = changeBaseSeq
       THEN
         /\ resSeq' = changeBaseSeq + 1
         /\ resEdits' = changeBaseEdits \cup {ServerEdit}
         /\ ackedSeq' = changeBaseSeq + 1
         /\ ackedEdits' = changeBaseEdits \cup {ServerEdit}
       ELSE
         /\ resSeq' = resSeq
         /\ resEdits' = resEdits
         /\ ackedSeq' = ackedSeq
         /\ ackedEdits' = ackedEdits
  /\ UNCHANGED <<
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       reconcileSeq, reconcileEdits
     >>

(* bodies.save commits UPDATE + server_operations in PostgreSQL, then throws before returning 503 retryable *)
ChangeSaveLostReply ==
  /\ changePhase = "saving"
  /\ dbSeq = changeBaseSeq
  /\ dbSeq' = changeBaseSeq + 1
  /\ dbEdits' = changeBaseEdits \cup {ServerEdit}
  /\ opRecorded' = TRUE
  /\ opSavedSeq' = changeBaseSeq + 1
  /\ orderingLocked' = FALSE
  /\ changePhase' = "retryable_error"
  /\ changeAttempts' = 0
  /\ changeBaseSeq' = 0
  /\ changeBaseEdits' = {}
  /\ openWatchStale' = IF openingState = "loaded" THEN TRUE ELSE openWatchStale
  /\ UNCHANGED <<
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* bodies.save sees stale baseSeq; if open, reconciles resident before releasing ordering lease and retrying *)
ChangeSaveStale ==
  /\ changePhase = "saving"
  /\ dbSeq /= changeBaseSeq
  /\ changeBaseSeq' = 0
  /\ changeBaseEdits' = {}
  /\ IF resOpen
       THEN
         /\ orderingLocked' = TRUE
         /\ changePhase' = "reconciling_stale"
         /\ changeAttempts' = changeAttempts
         /\ openWatchStale' = openWatchStale
       ELSE
         /\ orderingLocked' = FALSE
         /\ openWatchStale' = IF openingState = "loaded" THEN TRUE ELSE openWatchStale
         /\ IF changeAttempts < MaxAttempts
              THEN
                /\ changePhase' = "retry_loop"
                /\ changeAttempts' = changeAttempts
              ELSE
                /\ changePhase' = "exhausted"
                /\ changeAttempts' = 0
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       reconcileSeq, reconcileEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentChangeCoordinator.#reconcileResident after stale save: waits for settleAppend, then loads latest body *)
ChangeReconcileStaleLoad ==
  /\ changePhase = "reconciling_stale"
  /\ (resOpen => drainPhase /= "saving")
  /\ IF ~resOpen
       THEN
         /\ orderingLocked' = FALSE
         /\ openWatchStale' = IF openingState = "loaded" THEN TRUE ELSE openWatchStale
         /\ IF changeAttempts < MaxAttempts
              THEN
                /\ changePhase' = "retry_loop"
                /\ changeAttempts' = changeAttempts
              ELSE
                /\ changePhase' = "exhausted"
                /\ changeAttempts' = 0
         /\ UNCHANGED <<reconcileSeq, reconcileEdits>>
       ELSE
         /\ orderingLocked' = TRUE
         /\ changePhase' = "reconciling_stale_loaded"
         /\ reconcileSeq' = dbSeq
         /\ reconcileEdits' = dbEdits
         /\ UNCHANGED <<openWatchStale, changeAttempts>>
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changeBaseSeq, changeBaseEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* reconcileSavedBody after bodies.load on stale save: retries if a drain started, else adopts and finishes attempt *)
ChangeReconcileStaleFinish ==
  /\ changePhase = "reconciling_stale_loaded"
  /\ IF resOpen /\ reconcileSeq > resSeq /\ drainPhase = "saving"
       THEN
         /\ orderingLocked' = TRUE
         /\ changePhase' = "reconciling_stale"
         /\ reconcileSeq' = 0
         /\ reconcileEdits' = {}
         /\ UNCHANGED <<openWatchStale, resSeq, resEdits, ackedSeq, ackedEdits, changeAttempts>>
       ELSE
         /\ orderingLocked' = FALSE
         /\ openWatchStale' = IF openingState = "loaded" THEN TRUE ELSE openWatchStale
         /\ reconcileSeq' = 0
         /\ reconcileEdits' = {}
         /\ IF changeAttempts < MaxAttempts
              THEN
                /\ changePhase' = "retry_loop"
                /\ changeAttempts' = changeAttempts
              ELSE
                /\ changePhase' = "exhausted"
                /\ changeAttempts' = 0
         /\ IF resOpen /\ reconcileSeq > resSeq
              THEN
                /\ resSeq' = reconcileSeq
                /\ resEdits' = reconcileEdits
                /\ ackedSeq' = reconcileSeq
                /\ ackedEdits' = reconcileEdits
              ELSE
                /\ resSeq' = resSeq
                /\ resEdits' = resEdits
                /\ ackedSeq' = ackedSeq
                /\ ackedEdits' = ackedEdits
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changeBaseSeq, changeBaseEdits,
       appliedSeq, appliedEdits
     >>

Next ==
  \/ SessionOpenLoad
  \/ SessionOpenRegisterWarm
  \/ SessionOpenColdRegister
  \/ SessionOpenColdReloadStart
  \/ SessionOpenColdReloadLoad
  \/ SessionOpenColdReloadRegister
  \/ SessionCloseUnload
  \/ ClientMutate
  \/ DrainStart
  \/ DrainSaveSuccess
  \/ DrainSaveLostReply
  \/ DrainSaveStale
  \/ DrainAdopt
  \/ ChangeStartFindOp
  \/ ChangeReconcileAppliedLoad
  \/ ChangeReconcileAppliedFinish
  \/ ChangeReadBase
  \/ ChangeSaveCommit
  \/ ChangeSaveLostReply
  \/ ChangeSaveStale
  \/ ChangeReconcileStaleLoad
  \/ ChangeReconcileStaleFinish

Spec == Init /\ [][Next]_vars

(* Every acknowledged client save or applied server change remains durable in document_bodies *)
CommittedEditsPreserved ==
  /\ ackedSeq <= dbSeq
  /\ ackedEdits \subseteq dbEdits
  /\ appliedEdits \subseteq dbEdits

(* Whenever a server change reports applied and the Document settles open, resident holds it *)
ResidentHasAppliedChange ==
  (changePhase = "applied" /\ hasOpenClient /\ resOpen /\ openingState = "none" /\ drainPhase = "idle")
    => (resSeq >= appliedSeq /\ appliedEdits \subseteq resEdits)

=============================================================================
