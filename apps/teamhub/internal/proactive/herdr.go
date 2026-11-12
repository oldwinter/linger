package proactive

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// herdr events: a coding agent in a pane of the Human's herdr terminal
// workspace that waits on an approval or question, or that finished work.
const (
	SourceHerdr        = "herdr"
	HerdrAgentBlocked  = "agent_blocked"
	HerdrAgentFinished = "agent_finished"
)

// HerdrPane names one state of one herdr pane on the event's Computer.
type HerdrPane struct {
	PaneID         string `json:"pane_id"`
	StateChangeSeq int64  `json:"state_change_seq"`
}

// HerdrReport is what a Local Computer reported about one of its herdr panes.
type HerdrReport struct {
	ComputerID, Kind, PaneID      string
	StateChangeSeq                int64
	Agent, Name, Cwd, Title, Tail string
}

// ErrUnknownComputer means the reporting Computer is not an enrolled one.
var ErrUnknownComputer = errors.New("local computer is not enrolled")

// EnqueueHerdrEvent queues a herdr report as a proactive event of the
// Computer's owner, taken from TeamHub's own record. A pane state is one
// matter state, so a repeated report is judged once.
func (s *Service) EnqueueHerdrEvent(ctx context.Context, report HerdrReport) error {
	if report.Kind != HerdrAgentBlocked && report.Kind != HerdrAgentFinished || strings.TrimSpace(report.PaneID) == "" || report.StateChangeSeq < 0 {
		return ErrInvalidEvent
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	computer, err := store.New(tx).GetAgentRuntimeLocalComputer(ctx, report.ComputerID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && computer.RemovedAt.Valid {
		return ErrUnknownComputer
	}
	if err != nil {
		return err
	}
	if err := EnqueueEventTx(ctx, tx, HerdrEvent(computer.OwnerTenantID, computer.OwnerActorID, report)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// HerdrEvent is the proactive event of a herdr report. The pane is the matter
// and herdr's state counter its state; pane IDs are per herdr server, so the
// Computer is part of the matter.
func HerdrEvent(tenantID, ownerActorID string, report HerdrReport) Event {
	what := "A coding agent is waiting for an answer"
	if report.Kind == HerdrAgentFinished {
		what = "A coding agent finished its work"
	}
	summary := summaryLines(
		[2]string{"What", what}, [2]string{"Agent", report.Agent}, [2]string{"Agent name", report.Name},
		[2]string{"Directory", report.Cwd}, [2]string{"Title", report.Title}, [2]string{"Pane", report.PaneID},
		[2]string{"Last lines of the pane", report.Tail},
	)
	return Event{
		ComputerID: report.ComputerID, TenantID: tenantID, OwnerActorID: ownerActorID,
		Source: SourceHerdr, Kind: report.Kind, ExternalID: report.ComputerID + "/" + report.PaneID,
		State: strconv.FormatInt(report.StateChangeSeq, 10), Summary: summary,
		Herdr: &HerdrPane{PaneID: report.PaneID, StateChangeSeq: report.StateChangeSeq},
	}
}
