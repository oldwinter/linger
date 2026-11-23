package voicemedia

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/document"
)

func TestVoiceMediaFinalEndClampsArchiveToPersistedStopIntent(t *testing.T) {
	captureCreated := pgtype.Timestamptz{Time: time.Unix(1_800_000_000, 0), Valid: true}
	stopCreated := pgtype.Timestamptz{Time: captureCreated.Time.Add(52 * time.Second), Valid: true}
	if got, err := voiceMediaFinalEnd(captureCreated, stopCreated, 43*time.Minute.Milliseconds()); err != nil {
		t.Fatal(err)
	} else if got != 52_000 {
		t.Fatalf("voiceMediaFinalEnd()=%d want=52000", got)
	}
	if got, err := voiceMediaFinalEnd(captureCreated, stopCreated, 48_000); err != nil {
		t.Fatal(err)
	} else if got != 48_000 {
		t.Fatalf("voiceMediaFinalEnd()=%d want=48000", got)
	}
}

func TestVoiceTranscriptMustCoverCaptureBeforeMaterialization(t *testing.T) {
	for name, test := range map[string]struct {
		hasStart bool
		end      pgtype.Int8
		accepted int64
		want     bool
	}{
		"missing start": {end: pgtype.Int8{Int64: 2_000, Valid: true}, accepted: 2_000},
		"missing end":   {hasStart: true, accepted: 2_000},
		"behind end": {
			hasStart: true,
			end:      pgtype.Int8{Int64: 2_000, Valid: true},
			accepted: 1_999,
		},
		"at end": {
			hasStart: true,
			end:      pgtype.Int8{Int64: 2_000, Valid: true},
			accepted: 2_000,
			want:     true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			if got := voiceTranscriptCoversCapture(test.hasStart, test.end, test.accepted); got != test.want {
				t.Fatalf("voiceTranscriptCoversCapture()=%t want=%t", got, test.want)
			}
		})
	}
}

func TestTranscriptWaitExpiresInsteadOfFinalizingForever(t *testing.T) {
	created := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	if transcriptWaitExpired(created, created.Add(voiceTranscriptFinalizeTimeout-time.Millisecond)) {
		t.Fatal("transcript wait expired before the deadline")
	}
	if !transcriptWaitExpired(created, created.Add(voiceTranscriptFinalizeTimeout)) {
		t.Fatal("transcript wait did not expire at the deadline")
	}
}

func TestVoiceMaterializationStopsOnMissingDocumentOrExhaustedBudget(t *testing.T) {
	transient := errors.New("staging unavailable")
	for name, test := range map[string]struct {
		err      error
		attempts int32
		want     string
	}{
		"missing document first attempt": {err: fmt.Errorf("upload: %w", document.ErrNotFound), attempts: 1, want: "document_not_found"},
		"transient within budget":        {err: transient, attempts: voiceRetryMaxAttempts - 1},
		"transient budget exhausted":     {err: transient, attempts: voiceRetryMaxAttempts, want: "retry_exhausted"},
	} {
		t.Run(name, func(t *testing.T) {
			if got := voiceMaterializationTerminalCode(test.err, test.attempts); got != test.want {
				t.Fatalf("voiceMaterializationTerminalCode()=%q want=%q", got, test.want)
			}
		})
	}
}
