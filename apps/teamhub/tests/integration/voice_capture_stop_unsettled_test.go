package integration_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/livekit/protocol/livekit"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/voicemedia"
	"google.golang.org/protobuf/proto"
)

var errVoiceStagingUnavailable = errors.New("voice staging unavailable")

// unreadableVoiceStaging cannot inspect what a recorder left, so every
// reconciliation of a failed recorder fails.
type unreadableVoiceStaging struct{ stubVoiceMaterializer }

func (unreadableVoiceStaging) InspectSalvagePrefix(context.Context, string) (int64, error) {
	return 0, errVoiceStagingUnavailable
}

func (unreadableVoiceStaging) SegmentCount(context.Context, string, int64) (int64, error) {
	return 0, errVoiceStagingUnavailable
}

type unsettledStop struct {
	env      *testEnv
	q        *store.Queries
	capture  store.CaptureSession
	epoch    store.VoiceMediaEpoch
	recorder *voiceRecorderRoom
	service  *voicemedia.Service
}

func newUnsettledStop(t *testing.T) *unsettledStop {
	t.Helper()
	env, q, capture, epoch := newVoiceRecoveryLifecycle(t)
	recorder := newVoiceRecorderRoom(t, env.pool)
	recorder.handle = func(path string, _ []byte) proto.Message {
		if strings.HasSuffix(path, "/DeleteRoom") {
			return &livekit.DeleteRoomResponse{}
		}
		return nil
	}
	service := voicemedia.New(env.pool, recorder.provider(voicemedia.LiveKitConfig{}, env.pool), unreadableVoiceStaging{})
	return &unsettledStop{env: env, q: q, capture: capture, epoch: epoch, recorder: recorder, service: service}
}

// reconcile runs the Capture's reconciliation once the epoch's usual two
// second spacing has passed; retryDue also lets its stop backoff expire.
func (s *unsettledStop) reconcile(t *testing.T, retryDue bool) (time.Duration, error) {
	t.Helper()
	if _, err := s.env.pool.Exec(t.Context(), `UPDATE voice_media_epochs SET updated_at=clock_timestamp()-interval '3 seconds',
		stop_reconcile_retry_at=CASE WHEN $2 THEN NULL ELSE stop_reconcile_retry_at END WHERE id=$1`, s.epoch.ID, retryDue); err != nil {
		t.Fatal(err)
	}
	return s.service.RunJobStepForTest(t.Context(), voicemedia.CaptureReconcileArgs{CaptureSessionID: s.capture.ID})
}

func (s *unsettledStop) readEpoch(t *testing.T) store.VoiceMediaEpoch {
	t.Helper()
	epoch, err := s.q.GetVoiceMediaEpoch(t.Context(), s.epoch.ID)
	if err != nil {
		t.Fatal(err)
	}
	return epoch
}

func (s *unsettledStop) captureStatus(t *testing.T) string {
	t.Helper()
	capture, err := s.q.GetCaptureSessionForAccount(t.Context(), aliceCapture(s.capture.ID))
	if err != nil {
		t.Fatal(err)
	}
	return capture.Status
}

func (s *unsettledStop) stop(t *testing.T) {
	t.Helper()
	if _, err := s.service.EndCapture(t.Context(), voicemedia.EndCaptureRequest{AccountID: "account_alice", CaptureSessionID: s.capture.ID}); err != nil {
		t.Fatal(err)
	}
}

func TestVoiceCaptureStopThatNeverSettlesFailsTheCapture(t *testing.T) {
	allowParallelIntegrationTest(t)
	s := newUnsettledStop(t)
	s.recorder.report(t.Context(), s.epoch.StagingPrefix, "failed", time.Time{}, 0)

	for range 3 {
		if _, err := s.reconcile(t, true); !errors.Is(err, errVoiceStagingUnavailable) {
			t.Fatalf("recording reconciliation err=%v", err)
		}
	}
	if epoch := s.readEpoch(t); epoch.StopReconcileFailures != 0 || epoch.StopReconcileRetryAt.Valid {
		t.Fatalf("failures while recording spent the stop budget: %+v", epoch)
	}

	s.stop(t)
	if _, err := s.q.RequestVoiceSessionClose(t.Context(), s.capture.VoiceSessionID.String); err != nil {
		t.Fatal(err)
	}
	const budget = 12
	for failure := int32(1); failure <= budget; failure++ {
		if _, err := s.reconcile(t, true); !errors.Is(err, errVoiceStagingUnavailable) {
			t.Fatalf("failure %d err=%v", failure, err)
		}
		if got := s.readEpoch(t).StopReconcileFailures; got != failure {
			t.Fatalf("failure %d counted %d", failure, got)
		}
		// A wake inside the backoff neither retries nor spends the budget; the
		// job sleeps until the backoff ends.
		next, err := s.reconcile(t, false)
		backoff := min(5*time.Second<<(failure-1), 5*time.Minute)
		if err != nil || next > backoff || next < backoff-2*time.Second {
			t.Fatalf("failure %d backoff next=%v want~%v err=%v", failure, next, backoff, err)
		}
		if got := s.readEpoch(t).StopReconcileFailures; got != failure {
			t.Fatalf("wake inside backoff %d counted %d", failure, got)
		}
		if status := s.captureStatus(t); status != "finalizing" {
			t.Fatalf("failure %d ended the Capture early: %s", failure, status)
		}
	}
	if _, err := s.reconcile(t, true); err != nil {
		t.Fatalf("ending the Capture failed: %v", err)
	}
	if status := s.captureStatus(t); status != "failed" {
		t.Fatalf("exhausted budget left the Capture %s", status)
	}

	ended := s.readEpoch(t)
	if ended.ObservedState != "failed" || ended.DesiredState != "sealed" || ended.LastFailureCode.String != "stop_unsettled" {
		t.Fatalf("unsettled epoch=%+v", ended)
	}
	if count := captureFailedEvents(t, s.env, s.capture.RoomID, s.capture.ID); count != 1 {
		t.Fatalf("capture failed events=%d", count)
	}
	requireVoiceJobQueued(t, s.env.pool, voicemedia.StagingCleanupArgs{CaptureSessionID: s.capture.ID}, "unsettled Capture failure")
	if next, err := s.service.RunJobStepForTest(t.Context(), voicemedia.CaptureStopArgs{CaptureSessionID: s.capture.ID}); next != voicemedia.JobDone || err != nil {
		t.Fatalf("stop of the ended Capture next=%v err=%v", next, err)
	}
	if next, err := s.service.RunJobStepForTest(t.Context(), voicemedia.CaptureReconcileArgs{CaptureSessionID: s.capture.ID}); next != voicemedia.JobDone || err != nil {
		t.Fatalf("reconciliation of the ended Capture next=%v err=%v", next, err)
	}

	// The closing voice session waited on the Capture; it closes now.
	if _, err := s.env.pool.Exec(t.Context(), "UPDATE voice_sessions SET updated_at=clock_timestamp()-interval '10 seconds' WHERE id=$1", s.capture.VoiceSessionID.String); err != nil {
		t.Fatal(err)
	}
	if _, err := s.service.RunJobStepForTest(t.Context(), voicemedia.VoiceSessionReconcileArgs{VoiceSessionID: s.capture.VoiceSessionID.String}); err != nil {
		t.Fatal(err)
	}
	var voiceStatus string
	if err := s.env.pool.QueryRow(t.Context(), "SELECT status FROM voice_sessions WHERE id=$1", s.capture.VoiceSessionID.String).Scan(&voiceStatus); err != nil || voiceStatus != "closed" {
		t.Fatalf("voice session status=%s err=%v", voiceStatus, err)
	}
}

func TestVoiceCaptureStopNeverFailsARecorderThatMayStillWrite(t *testing.T) {
	allowParallelIntegrationTest(t)
	s := newUnsettledStop(t)
	s.recorder.report(t.Context(), s.epoch.StagingPrefix, "active", time.Now(), 2_000)
	s.stop(t)

	if err := s.q.DeferVoiceMediaEpochReconcile(t.Context(), store.DeferVoiceMediaEpochReconcileParams{
		ID: s.epoch.ID, Failed: true, RetryDelay: pgtype.Interval{Microseconds: time.Minute.Microseconds(), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if epoch := s.readEpoch(t); epoch.StopReconcileFailures != 0 || epoch.StopReconcileRetryAt.Valid {
		t.Fatalf("a running recorder spent the stop budget: %+v", epoch)
	}

	// Even a spent budget cannot end a Capture whose recorder has not sent its
	// terminal receipt: reconciliation goes on and the stop stays owed.
	if _, err := s.env.pool.Exec(t.Context(), "UPDATE voice_media_epochs SET stop_reconcile_failures=100 WHERE id=$1", s.epoch.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.reconcile(t, true); err != nil {
		t.Fatal(err)
	}
	if status := s.captureStatus(t); status != "finalizing" {
		t.Fatalf("a running recorder's Capture became %s", status)
	}
	if epoch := s.readEpoch(t); epoch.ObservedState == "failed" {
		t.Fatalf("a running recorder's epoch failed: %+v", epoch)
	}
	if _, err := s.q.GetOwedVoiceMediaStop(t.Context(), s.capture.ID); err != nil {
		t.Fatalf("stop is no longer owed to the running recorder: %v", err)
	}
}
