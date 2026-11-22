package integration_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/voicemedia"
)

func TestVoiceRecorderClockSkewDoesNotStrandStop(t *testing.T) {
	allowParallelIntegrationTest(t)
	for _, stopBeforeConfirmation := range []bool{false, true} {
		t.Run(strconv.FormatBool(stopBeforeConfirmation), func(t *testing.T) {
			env, q, capture, epoch := newVoiceRecoveryLifecycle(t)
			capture, err := q.GetCaptureSessionForAccount(t.Context(), aliceCapture(capture.ID))
			if err != nil {
				t.Fatal(err)
			}
			requested := capture.CreatedAt.Time
			started := requested.Add(-5 * time.Second)
			if _, err = env.pool.Exec(t.Context(), "UPDATE voice_sessions SET created_at=$2 WHERE id=$1", capture.VoiceSessionID.String, requested.Add(-time.Second)); err != nil {
				t.Fatal(err)
			}
			if _, err = env.pool.Exec(t.Context(), "UPDATE capture_sessions SET status='starting',transcript_start_offset_ms=1000 WHERE id=$1", capture.ID); err != nil {
				t.Fatal(err)
			}
			if _, err = env.pool.Exec(t.Context(), "UPDATE voice_media_epochs SET observed_state='requested',provider_egress_id=NULL,first_archived_ms=NULL,archived_through_ms=NULL WHERE id=$1", epoch.ID); err != nil {
				t.Fatal(err)
			}
			recorder := newVoiceRecorderRoom(t, env.pool)
			recorder.direct("recovery-tx", epoch.StagingPrefix)
			recorder.report(t.Context(), epoch.StagingPrefix, "active", started, 2_000)
			recorder.stop = func(ctx context.Context, prefix string) {
				recorder.report(ctx, prefix, "available", started, 2_000)
			}
			service := voicemedia.New(env.pool, recorder.provider(voicemedia.LiveKitConfig{}, env.pool), nil)
			stop := func() {
				t.Helper()
				if _, err := service.EndCapture(t.Context(), voicemedia.EndCaptureRequest{AccountID: "account_alice", CaptureSessionID: capture.ID}); err != nil {
					t.Fatal(err)
				}
				if _, err := env.pool.Exec(t.Context(), "UPDATE capture_sessions SET stop_requested_at=$2 WHERE id=$1", capture.ID, requested.Add(2*time.Second)); err != nil {
					t.Fatal(err)
				}
			}
			reconcile := func() {
				t.Helper()
				if _, err := env.pool.Exec(t.Context(), "UPDATE voice_media_epochs SET updated_at=clock_timestamp()-interval '3 seconds' WHERE id=$1", epoch.ID); err != nil {
					t.Fatal(err)
				}
				if _, err := service.RunJobStepForTest(t.Context(), voicemedia.CaptureReconcileArgs{CaptureSessionID: capture.ID}); err != nil {
					t.Fatalf("recorder clock skew stranded reconciliation: %v", err)
				}
			}
			if stopBeforeConfirmation {
				stop()
			}
			reconcile()
			confirmed, err := q.GetCaptureSessionForAccount(t.Context(), aliceCapture(capture.ID))
			if err != nil || !confirmed.CreatedAt.Time.Equal(requested) || confirmed.TranscriptStartOffsetMs.Int64 != 1_000 {
				t.Fatalf("capture left the server timeline: %+v err=%v", confirmed, err)
			}
			if !stopBeforeConfirmation {
				stop()
			}
			requireVoiceJobQueued(t, env.pool, voicemedia.CaptureStopArgs{CaptureSessionID: capture.ID}, "clock-skewed recorder admission")
			if _, err = service.RunJobStepForTest(t.Context(), voicemedia.CaptureStopArgs{CaptureSessionID: capture.ID}); err != nil {
				t.Fatal(err)
			}
			if recorder.stops.Load() != 1 {
				t.Fatalf("recorder was not stopped: %d", recorder.stops.Load())
			}
			reconcile()
			reconcile()
			sealed, err := q.GetVoiceMediaEpoch(t.Context(), epoch.ID)
			if err != nil || sealed.ObservedState != "available" || sealed.FinalEndMs.Int64 != 2_000 || sealed.FirstArchivedMs.Int64 != 0 {
				t.Fatalf("recorded audio did not seal on its full timeline: %+v err=%v", sealed, err)
			}
			completed, err := q.GetCaptureSessionForAccount(t.Context(), aliceCapture(capture.ID))
			if err != nil || !completed.MaterializeRequestedAt.Valid {
				t.Fatalf("stopped capture never reached materialization: %+v err=%v", completed, err)
			}
			requireVoiceJobQueued(t, env.pool, voicemedia.CaptureMaterializeArgs{CaptureSessionID: capture.ID}, "clock-skewed recording completion")
		})
	}
}
