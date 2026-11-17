-- +goose Up
-- TeamHub hands out each Voice Runtime transcript epoch so a restarted runtime
-- job never reuses a number an earlier job already wrote coverage or segments
-- under. Open sessions resume after the highest epoch they already used.
ALTER TABLE voice_sessions
  ADD COLUMN next_media_epoch integer NOT NULL DEFAULT 0 CHECK (next_media_epoch >= 0);

UPDATE voice_sessions voice
SET next_media_epoch = 1 + coalesce(greatest(
  (SELECT max(segment.media_epoch)
   FROM voice_transcript_segments segment
   WHERE segment.voice_session_id = voice.id),
  (SELECT max(substring(coverage.stream_id FROM '^voice-runtime-v2:[^:]+:([0-9]+)$')::integer)
   FROM capture_transcript_coverage coverage
   JOIN capture_sessions capture ON capture.id = coverage.session_id
   WHERE capture.voice_session_id = voice.id)
), -1)
WHERE voice.status <> 'closed';
