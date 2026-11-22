package reminder

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

func TestIsPreviousOccurrenceUnfinished(t *testing.T) {
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	ts := func(at time.Time) pgtype.Timestamptz {
		return pgtype.Timestamptz{Time: at, Valid: true}
	}
	cases := []struct {
		name  string
		state store.GetRoutineLatestOccurrenceStateRow
		want  bool
	}{
		{
			name:  "no prior occurrence allows fire",
			state: store.GetRoutineLatestOccurrenceStateRow{},
			want:  false,
		},
		{
			name: "undelivered quiet wake within 24h skips fire",
			state: store.GetRoutineLatestOccurrenceStateRow{
				LatestUndeliveredWakeAt: ts(now.Add(-5 * time.Minute)),
			},
			want: true,
		},
		{
			name: "undelivered quiet wake older than 24h no longer blocks",
			state: store.GetRoutineLatestOccurrenceStateRow{
				LatestUndeliveredWakeAt: ts(now.Add(-24*time.Hour - time.Second)),
			},
			want: false,
		},
		{
			name: "latest trigger message without terminal run within 24h skips fire",
			state: store.GetRoutineLatestOccurrenceStateRow{
				LatestMessageCreatedAt: ts(now.Add(-10 * time.Minute)),
				LatestMessageTerminal:  false,
			},
			want: true,
		},
		{
			name: "latest trigger message with terminal run allows fire",
			state: store.GetRoutineLatestOccurrenceStateRow{
				LatestMessageCreatedAt: ts(now.Add(-10 * time.Minute)),
				LatestMessageTerminal:  true,
			},
			want: false,
		},
		{
			name: "latest trigger message older than 24h without terminal run allows fire",
			state: store.GetRoutineLatestOccurrenceStateRow{
				LatestMessageCreatedAt: ts(now.Add(-24 * time.Hour)),
				LatestMessageTerminal:  false,
			},
			want: false,
		},
		{
			name: "terminal message still skipped when a newer undelivered wake exists",
			state: store.GetRoutineLatestOccurrenceStateRow{
				LatestUndeliveredWakeAt: ts(now.Add(-2 * time.Minute)),
				LatestMessageCreatedAt:  ts(now.Add(-20 * time.Minute)),
				LatestMessageTerminal:   true,
			},
			want: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isPreviousOccurrenceUnfinished(tc.state, now); got != tc.want {
				t.Fatalf("got=%v want=%v state=%+v", got, tc.want, tc.state)
			}
		})
	}
}
