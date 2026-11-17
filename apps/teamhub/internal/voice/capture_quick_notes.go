package voice

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/jobs"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomevent"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/voicequicknotes"
)

const (
	captureQuickNotesKind = "voice.capture_quick_notes"
	// captureQuickNotesMaxAttempts allows one retry; past it the notes are
	// given up and the Message keeps the recording and transcript.
	captureQuickNotesMaxAttempts = 2
)

// CaptureQuickNotesArgs names a recording whose completion Message promised
// quick notes.
type CaptureQuickNotesArgs struct {
	CaptureSessionID string `json:"capture_session_id"`
}

// Kind names the River job.
func (CaptureQuickNotesArgs) Kind() string { return captureQuickNotesKind }

// InsertOpts keeps one unfinished job per recording.
func (CaptureQuickNotesArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue: jobs.QueueDefault, MaxAttempts: captureQuickNotesMaxAttempts,
		UniqueOpts: river.UniqueOpts{ByArgs: true, ByState: []rivertype.JobState{
			rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRetryable,
			rivertype.JobStateRunning, rivertype.JobStateScheduled,
		}},
	}
}

// AddCaptureQuickNotesWorker registers the job that writes quick notes. The job
// is queued only when a model writes them.
func (s *Service) AddCaptureQuickNotesWorker(workers *river.Workers) {
	river.AddWorker(workers, &captureQuickNotesWorker{service: s})
}

type captureQuickNotesWorker struct {
	river.WorkerDefaults[CaptureQuickNotesArgs]
	service *Service
}

func (w *captureQuickNotesWorker) Timeout(*river.Job[CaptureQuickNotesArgs]) time.Duration {
	return voicequicknotes.Timeout + 10*time.Second
}

func (w *captureQuickNotesWorker) Work(ctx context.Context, job *river.Job[CaptureQuickNotesArgs]) error {
	return w.service.writeCaptureQuickNotes(ctx, job.Args.CaptureSessionID, job.Attempt >= captureQuickNotesMaxAttempts)
}

// writeCaptureQuickNotes writes a pending recording's quick notes onto its
// Capture and tells the Room. A failure retries once; the last attempt gives
// the notes up so the Message stops waiting for them.
func (s *Service) writeCaptureQuickNotes(ctx context.Context, captureID string, lastAttempt bool) error {
	session, err := s.queries.GetPendingCaptureQuickNotes(ctx, captureID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	started := time.Now()
	notes, err := s.composeCaptureQuickNotes(ctx, session)
	if err != nil {
		if !lastAttempt {
			return err
		}
		s.logger.Error("give up recording quick notes", "capture_session_id", captureID, "duration_ms", time.Since(started).Milliseconds(), "error", err)
		return s.settleCaptureQuickNotes(ctx, session, "failed", nil)
	}
	encoded, err := json.Marshal(notes)
	if err != nil {
		return err
	}
	s.logger.Info("recording quick notes written", "capture_session_id", captureID, "duration_ms", time.Since(started).Milliseconds(), "sections", len(notes.Sections))
	return s.settleCaptureQuickNotes(ctx, session, "ready", encoded)
}

func (s *Service) composeCaptureQuickNotes(ctx context.Context, session store.CaptureSession) (voicequicknotes.Notes, error) {
	if s.quickNotes == nil {
		return voicequicknotes.Notes{}, errors.New("no model writes recording quick notes")
	}
	transcript, err := s.renderCaptureTranscript(ctx, session, session.UpdatedAt.Time)
	if err != nil {
		return voicequicknotes.Notes{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, voicequicknotes.Timeout+5*time.Second)
	defer cancel()
	return s.quickNotes.Write(ctx, roomagent.ModelCallOwner{TenantID: session.TenantID, OwnerActorID: session.CreatedByActorID}, session.ID, transcript)
}

func (s *Service) settleCaptureQuickNotes(ctx context.Context, session store.CaptureSession, state string, notes []byte) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		queries := s.queries.WithTx(tx)
		settled, err := queries.SettleCaptureQuickNotes(ctx, store.SettleCaptureQuickNotesParams{ID: session.ID, State: textValue(state), Notes: notes})
		if err != nil || settled == 0 {
			return err
		}
		return roomevent.AppendCaptureSessionChanged(ctx, queries, session.TenantID, session.RoomID, session.CreatedByActorID, session.ID, "finalized")
	})
}
