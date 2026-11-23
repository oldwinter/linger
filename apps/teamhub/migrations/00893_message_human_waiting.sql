-- +goose Up
-- A Human who acted through a hidden agent_runtime Message, by answering a
-- card or asking during a recording, waits for the Agent's answer as in chat.
-- The flag rides on the Inbox notification, so the Agent Service schedules
-- that wake as chat instead of as proactive work.
ALTER TABLE public.messages
    ADD COLUMN human_waiting boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT messages_human_waiting_runtime_check CHECK ((NOT human_waiting OR message_kind = 'agent_runtime'));

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.agent_inbox_notification_payload(p_input text, p_tenant text, p_agent text, p_inbox text, p_message text, p_sequence bigint, p_mentioned boolean, p_targeted boolean) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
WITH message AS (
 SELECT message.id,message.body,message.segments,message.author_actor_id,author.display_name AS author,author.kind AS author_kind,
  to_jsonb(message.context_message_ids) AS context_message_ids,message.team_protocol,message.attachments,
  'room_event_v1' AS cursor_encoding,message.message_kind,message.fired_routine_id IS NOT NULL AS fired_routine,
  message.human_waiting
 FROM messages message JOIN actors author ON author.id=message.author_actor_id AND author.tenant_id=message.tenant_id
 WHERE message.id=p_message AND message.tenant_id=p_tenant
  AND NOT starts_with(p_inbox,'taskmeta:')
 UNION ALL
 SELECT message.id,message.body,message.segments,message.author_actor_id,author.display_name,author.kind,
  '[]'::jsonb,NULL,'[]'::jsonb,'meta_seq_v1',NULL,false,false
 FROM task_meta_callback_messages message JOIN actors author ON author.id=message.author_actor_id AND author.tenant_id=message.tenant_id
 WHERE starts_with(p_inbox,'taskmeta:') AND message.id=p_message AND message.tenant_id=p_tenant
)
SELECT jsonb_build_object(
 'messageId',p_input,
 'rawMessage','',
 'segments',jsonb_build_array(jsonb_build_object('type','text','content','')),
 'sourceInboxIds',jsonb_build_array(p_inbox),
 'invocationMessageIds',jsonb_build_array(message.id),
 'notificationRender',jsonb_build_object('agentName',agent.display_name,
  'triggeredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 'acceptedNotification',jsonb_build_object(
  'inboxId',p_inbox,'cursorEncoding',message.cursor_encoding,
  'after',greatest(p_sequence-1,0)::text,'through',p_sequence::text,'targeted',p_targeted,
  'messages',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
   'id',message.id,'body',message.body,'author',message.author,
   'authorActorId',message.author_actor_id,
   'authorType',CASE WHEN message.author_kind='agent' THEN 'agent' ELSE 'user' END,
   'messageKind',message.message_kind,'firedRoutine',nullif(message.fired_routine,false),
   'humanWaiting',nullif(message.human_waiting,false),
   'mentioned',p_mentioned,'contextMessageIds',message.context_message_ids,
   'resourceReferences',agent_inbox_resource_references(message.segments,message.attachments),
   'teamProtocol',message.team_protocol)))))
FROM message JOIN actors agent ON agent.id=p_agent AND agent.tenant_id=p_tenant;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.agent_inbox_notification_payload(p_input text, p_tenant text, p_agent text, p_inbox text, p_message text, p_sequence bigint, p_mentioned boolean, p_targeted boolean) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
WITH message AS (
 SELECT message.id,message.body,message.segments,message.author_actor_id,author.display_name AS author,author.kind AS author_kind,
  to_jsonb(message.context_message_ids) AS context_message_ids,message.team_protocol,message.attachments,
  'room_event_v1' AS cursor_encoding,message.message_kind,message.fired_routine_id IS NOT NULL AS fired_routine
 FROM messages message JOIN actors author ON author.id=message.author_actor_id AND author.tenant_id=message.tenant_id
 WHERE message.id=p_message AND message.tenant_id=p_tenant
  AND NOT starts_with(p_inbox,'taskmeta:')
 UNION ALL
 SELECT message.id,message.body,message.segments,message.author_actor_id,author.display_name,author.kind,
  '[]'::jsonb,NULL,'[]'::jsonb,'meta_seq_v1',NULL,false
 FROM task_meta_callback_messages message JOIN actors author ON author.id=message.author_actor_id AND author.tenant_id=message.tenant_id
 WHERE starts_with(p_inbox,'taskmeta:') AND message.id=p_message AND message.tenant_id=p_tenant
)
SELECT jsonb_build_object(
 'messageId',p_input,
 'rawMessage','',
 'segments',jsonb_build_array(jsonb_build_object('type','text','content','')),
 'sourceInboxIds',jsonb_build_array(p_inbox),
 'invocationMessageIds',jsonb_build_array(message.id),
 'notificationRender',jsonb_build_object('agentName',agent.display_name,
  'triggeredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 'acceptedNotification',jsonb_build_object(
  'inboxId',p_inbox,'cursorEncoding',message.cursor_encoding,
  'after',greatest(p_sequence-1,0)::text,'through',p_sequence::text,'targeted',p_targeted,
  'messages',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
   'id',message.id,'body',message.body,'author',message.author,
   'authorActorId',message.author_actor_id,
   'authorType',CASE WHEN message.author_kind='agent' THEN 'agent' ELSE 'user' END,
   'messageKind',message.message_kind,'firedRoutine',nullif(message.fired_routine,false),
   'mentioned',p_mentioned,'contextMessageIds',message.context_message_ids,
   'resourceReferences',agent_inbox_resource_references(message.segments,message.attachments),
   'teamProtocol',message.team_protocol)))))
FROM message JOIN actors agent ON agent.id=p_agent AND agent.tenant_id=p_tenant;
$$;
-- +goose StatementEnd

ALTER TABLE public.messages
    DROP CONSTRAINT messages_human_waiting_runtime_check,
    DROP COLUMN human_waiting;
