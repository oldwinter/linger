-- name: IsRunStartedByDirectChatHuman :one
-- Whether the Agent's running Run in its direct chat carries something the
-- Human did there: a Message they wrote, or the result of a card they
-- decided themselves. TeamHub also writes Messages in the Human's name with a
-- card's context, such as a reminder about a card still pending, so a card's
-- context alone proves nothing; its decision must name the Human. Quiet
-- wakes, Routine fires and Task callbacks carry neither. A Room input names
-- the Messages it carries in payload invocationMessageIds.
SELECT EXISTS (
  SELECT 1
  FROM agent_local_runs run
  JOIN agent_execution_contexts context ON context.context_key=run.context_key
  JOIN agent_local_run_inputs relation ON relation.run_id=run.run_id
  JOIN agent_runtime_inputs input
    ON input.context_key=relation.context_key AND input.input_id=relation.input_id
  JOIN messages message ON message.room_id=sqlc.arg(room_id)::text
   AND (input.source_message_id=message.id
        OR jsonb_typeof(input.payload->'invocationMessageIds')='array'
           AND input.payload->'invocationMessageIds' @> to_jsonb(message.id))
  WHERE run.run_id=sqlc.arg(run_id)::text AND run.status='running'
    AND run.status_room_id=sqlc.arg(room_id)::text
    AND context.tenant_id=sqlc.arg(tenant_id)::text
    AND context.agent_actor_id=sqlc.arg(agent_actor_id)::text
    AND message.author_actor_id=sqlc.arg(human_actor_id)::text
    AND (
      message.message_kind='conversation' AND message.card_context_message_id IS NULL
      OR EXISTS (
        SELECT 1 FROM decisions decision
        WHERE decision.message_id=message.card_context_message_id
          AND decision.room_id=message.room_id
          AND decision.decided_by_actor_id=sqlc.arg(human_actor_id)::text
      )
    )
)::boolean;
