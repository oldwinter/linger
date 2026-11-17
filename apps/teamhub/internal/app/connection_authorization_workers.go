package app

import (
	"context"
	"time"

	"github.com/riverqueue/river"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/externalsource"
)

// connectionAuthorizationSettleWorker settles the cards waiting on a Connection
// that just became active and wakes their Agents.
type connectionAuthorizationSettleWorker struct {
	river.WorkerDefaults[externalsource.ConnectionAuthorizationSettleArgs]
	app *App
}

// Settling and expiring authorization cards only reads and writes the
// database, so a minute is a generous backstop.
func (*connectionAuthorizationSettleWorker) Timeout(*river.Job[externalsource.ConnectionAuthorizationSettleArgs]) time.Duration {
	return time.Minute
}

func (w *connectionAuthorizationSettleWorker) Work(ctx context.Context, job *river.Job[externalsource.ConnectionAuthorizationSettleArgs]) error {
	return w.app.typedCards.SettleConnectionAuthorizations(ctx, job.Args.ConnectionID)
}

// profileSetupReminderWorker reminds AnotherMe about a Profile setup left
// unfinished after a Connection's first activation, once the Room is quiet.
type profileSetupReminderWorker struct {
	river.WorkerDefaults[externalsource.ProfileSetupReminderArgs]
	app *App
}

func (*profileSetupReminderWorker) Timeout(*river.Job[externalsource.ProfileSetupReminderArgs]) time.Duration {
	return time.Minute
}

// A Room still in conversation snoozes the job until it has been quiet; a
// snooze spends no attempt.
func (w *profileSetupReminderWorker) Work(ctx context.Context, job *river.Job[externalsource.ProfileSetupReminderArgs]) error {
	wait, err := w.app.typedCards.RemindProfileSetup(ctx, job.Args.ConnectionID, time.Now())
	if err != nil || wait == 0 {
		return err
	}
	return river.JobSnooze(wait)
}
