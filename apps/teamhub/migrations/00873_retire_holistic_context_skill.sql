-- +goose Up
-- The holistic-context Skill is retired: its method is now part of every
-- Agent's personal context instructions. Skills and Manifests are never
-- deleted, so its Manifests are revoked, which hides them from every listing
-- and effective Skill set, and the Agent bindings that named it are removed
-- the way a user removes one: disabled and soft-deleted at the Agent's next
-- binding version. It was a default Skill, so it first stops being one: a
-- default Skill whose latest Manifest is revoked would block every Agent's
-- effective Skill set.
UPDATE skills
SET default_agent_types='{}'
WHERE skill_id='simplexai_holistic_context';

UPDATE agent_skill_bindings binding
SET enabled=false,
    binding_version=next.binding_version,
    updated_by_actor_id=NULL,
    updated_at=now(),
    deleted_at=now()
FROM (
    SELECT agent_actor_id,max(binding_version)+1 AS binding_version
    FROM agent_skill_bindings
    GROUP BY agent_actor_id
) next
WHERE binding.agent_actor_id=next.agent_actor_id
  AND binding.skill_id='simplexai_holistic_context'
  AND binding.deleted_at IS NULL;

UPDATE skill_manifests
SET state='revoked'
WHERE skill_id='simplexai_holistic_context'
  AND state<>'revoked';

-- +goose Down
-- Revoked Manifests are terminal, so the retirement is not reversed.
SELECT 1;
