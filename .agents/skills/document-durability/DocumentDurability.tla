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
  appliedSeq,
  appliedEdits,
  ackedSeq,
  ackedEdits

vars == <<
  dbSeq, dbEdits, opRecorded, opSavedSeq,
  openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
  resOpen, resSeq, resEdits, pending, clientEditUsed,
  drainPhase, batchBaseSeq, batchEdits, batchPending,
  orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
  /\ appliedSeq = 0
  /\ appliedEdits = {}
  /\ ackedSeq = 0
  /\ ackedEdits = {}

(* DocumentSessionManager.open: await bodies.load(documentId) *)
SessionOpenLoad ==
  /\ openingState = "none"
  /\ openingState' = "loaded"
  /\ openLoadedSeq' = dbSeq
  /\ openLoadedEdits' = dbEdits
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       hasOpenClient, resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentSessionManager.open -> registerDocument -> connected durable ACK *)
SessionOpenRegister ==
  /\ openingState = "loaded"
  /\ openingState' = "none"
  /\ hasOpenClient' = TRUE
  /\ openLoadedSeq' = 0
  /\ openLoadedEdits' = {}
  /\ IF ~resOpen
       THEN
         /\ resOpen' = TRUE
         /\ resSeq' = openLoadedSeq
         /\ resEdits' = openLoadedEdits
         /\ ackedSeq' = openLoadedSeq
         /\ ackedEdits' = openLoadedEdits
       ELSE IF drainPhase = "saving" /\ batchBaseSeq + 1 = openLoadedSeq /\ batchEdits = openLoadedEdits
       THEN
         /\ resOpen' = TRUE
         /\ resSeq' = openLoadedSeq
         /\ resEdits' = openLoadedEdits
         /\ ackedSeq' = openLoadedSeq
         /\ ackedEdits' = openLoadedEdits
       ELSE IF openLoadedSeq > resSeq /\ drainPhase /= "saving"
       THEN
         /\ resOpen' = TRUE
         /\ resSeq' = openLoadedSeq
         /\ resEdits' = openLoadedEdits
         /\ ackedSeq' = openLoadedSeq
         /\ ackedEdits' = openLoadedEdits
       ELSE
         /\ resOpen' = resOpen
         /\ resSeq' = resSeq
         /\ resEdits' = resEdits
         /\ ackedSeq' = resSeq
         /\ ackedEdits' = resEdits
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
       appliedSeq, appliedEdits
     >>

(* Last connection disconnects after beforeUnloadDocument flushes pending mutations *)
SessionCloseUnload ==
  /\ hasOpenClient
  /\ resOpen
  /\ drainPhase = "idle"
  /\ pending = {}
  /\ hasOpenClient' = FALSE
  /\ resOpen' = FALSE
  /\ resSeq' = 0
  /\ resEdits' = {}
  /\ UNCHANGED <<
       dbSeq, dbEdits, opRecorded, opSavedSeq,
       openingState, openLoadedSeq, openLoadedEdits,
       pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, clientEditUsed,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       batchBaseSeq,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, pending, clientEditUsed,
       batchEdits, batchPending,
       orderingLocked, changePhase, changeAttempts, changeBaseSeq, changeBaseEdits,
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       changeBaseSeq, changeBaseEdits, ackedSeq, ackedEdits
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
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       orderingLocked, changeAttempts,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* DocumentChangeCoordinator.apply commits bodies.save and runs #publish *)
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
       drainPhase, batchBaseSeq, batchEdits, batchPending
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
  /\ UNCHANGED <<
       openingState, openLoadedSeq, openLoadedEdits, hasOpenClient,
       resOpen, resSeq, resEdits, pending, clientEditUsed,
       drainPhase, batchBaseSeq, batchEdits, batchPending,
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

(* bodies.save sees stale baseSeq, releases ordering lease, and retries or exhausts maxAttempts *)
ChangeSaveStale ==
  /\ changePhase = "saving"
  /\ dbSeq /= changeBaseSeq
  /\ orderingLocked' = FALSE
  /\ changeBaseSeq' = 0
  /\ changeBaseEdits' = {}
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
       appliedSeq, appliedEdits, ackedSeq, ackedEdits
     >>

Next ==
  \/ SessionOpenLoad
  \/ SessionOpenRegister
  \/ SessionCloseUnload
  \/ ClientMutate
  \/ DrainStart
  \/ DrainSaveSuccess
  \/ DrainSaveLostReply
  \/ DrainSaveStale
  \/ DrainAdopt
  \/ ChangeStartFindOp
  \/ ChangeReadBase
  \/ ChangeSaveCommit
  \/ ChangeSaveLostReply
  \/ ChangeSaveStale

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
