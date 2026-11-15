-- name: GetHumanMessagePinAuthority :one
SELECT message.id AS message_id,message.tenant_id,message.room_id,caller.id AS actor_id
FROM messages message
JOIN actors caller
  ON caller.tenant_id=message.tenant_id
 AND caller.account_id=sqlc.arg(account_id)::text
 AND caller.kind='human'
JOIN room_members membership
  ON membership.tenant_id=message.tenant_id
 AND membership.room_id=collaboration_membership_room_id(message.room_id)
 AND membership.actor_id=caller.id
WHERE message.id=sqlc.arg(message_id)::text
  AND message.room_id=sqlc.arg(room_id)::text
  AND message.message_kind='conversation'
FOR KEY SHARE OF message,membership;

-- name: GetRoomMessagePinAuthority :one
SELECT room.id AS room_id,room.tenant_id,caller.id AS actor_id
FROM rooms room
JOIN actors caller
  ON caller.tenant_id=room.tenant_id
 AND caller.account_id=sqlc.arg(account_id)::text
 AND caller.kind='human'
JOIN room_members membership
  ON membership.tenant_id=room.tenant_id
 AND membership.room_id=collaboration_membership_room_id(room.id)
 AND membership.actor_id=caller.id
WHERE room.id=sqlc.arg(room_id)::text
  AND room.deleted_at IS NULL
FOR KEY SHARE OF room,membership;

-- name: PinMessage :execrows
INSERT INTO message_pins(tenant_id,room_id,message_id,pinned_by_actor_id)
VALUES($1,$2,$3,$4)
ON CONFLICT DO NOTHING;

-- name: UnpinMessage :execrows
DELETE FROM message_pins
WHERE room_id=$1 AND message_id=$2;

-- name: ListMessagePinsForRoom :many
WITH pinned AS (
  SELECT pin.message_id,pin.tenant_id,pin.pinned_by_actor_id,pin.created_at
  FROM message_pins pin
  WHERE pin.room_id=sqlc.arg(room_id)::text
  ORDER BY pin.created_at DESC,pin.message_id DESC
  LIMIT 50
)
SELECT pin.message_id,pin.pinned_by_actor_id,pin.created_at AS pinned_at,
       m.id,m.tenant_id,m.room_id,m.room_seq,m.author_actor_id,m.body,m.segments,
       m.card_context_message_id,m.message_kind,m.notice,m.card_title,m.card_kind,
       m.created_at,m.reply_to_message_id,
       (card.message_id IS NOT NULL)::boolean AS has_card,
       author.kind AS author_kind,author.display_name AS author_display_name,
       author.account_id AS author_account_id,author.handle AS author_handle,
       author.created_at AS author_created_at
FROM pinned pin
JOIN messages m
  ON m.id=pin.message_id
 AND m.room_id=sqlc.arg(room_id)::text
 AND m.tenant_id=pin.tenant_id
JOIN actors author ON author.id=m.author_actor_id AND author.tenant_id=m.tenant_id
LEFT JOIN message_cards card ON card.message_id=m.id
ORDER BY pin.created_at DESC,pin.message_id DESC;
