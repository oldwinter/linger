package proactive

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

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

// HerdrEvent is the proactive event of a herdr report. Each pane state is its
// own outside event: a later block or completion of the same pane is a new
// one, so a mandate act for one never stands in for the next. The external ID
// therefore carries herdr's state counter; pane IDs are per herdr server, so
// it carries the Computer too.
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
	state := strconv.FormatInt(report.StateChangeSeq, 10)
	return Event{
		ComputerID: report.ComputerID, TenantID: tenantID, OwnerActorID: ownerActorID,
		Source: SourceHerdr, Kind: report.Kind, ExternalID: herdrExternalID(report.ComputerID, report.PaneID, report.StateChangeSeq),
		State: state, Summary: summary,
		Herdr: &HerdrPane{PaneID: report.PaneID, StateChangeSeq: report.StateChangeSeq},
	}
}

func herdrExternalID(computerID, paneID string, stateChangeSeq int64) string {
	return computerID + "/" + paneID + "/" + strconv.FormatInt(stateChangeSeq, 10)
}

// HerdrAsk is whether AnotherMe may ask its Human about one herdr pane state.
type HerdrAsk int

const (
	// HerdrAskUnreported means the Computer did not report this pane state as a
	// herdr event judged today or yesterday.
	HerdrAskUnreported HerdrAsk = iota
	// HerdrAskGated means quiet hours or the daily limit gated the event to
	// tracking, and that gate still holds; it is followed up later.
	HerdrAskGated
	// HerdrAskAllowed means the event could remind, or its gate has lifted.
	HerdrAskAllowed
)

// HerdrAskable reports whether a question card may be bound to this pane
// state now. A card can only be bound to a pane state that really asked, and
// a gated event is told only once its gate lifts, by the same rule that gated
// it: the card is how AnotherMe tells the Human about a blocked pane.
func (s *Service) HerdrAskable(ctx context.Context, owner Owner, computerID, paneID string, stateChangeSeq int64) (HerdrAsk, error) {
	state := strconv.FormatInt(stateChangeSeq, 10)
	matter := eventMatter(SourceHerdr, herdrExternalID(computerID, paneID, stateChangeSeq), state)
	queries := store.New(s.pool)
	now := s.now()
	for _, day := range []time.Time{Day(now), Day(now.Add(-24 * time.Hour))} {
		reminded, err := queries.GetProactiveSignalReminded(ctx, store.GetProactiveSignalRemindedParams{
			TenantID: owner.TenantID, OwnerActorID: owner.ActorID, Source: "event", SourceKey: SourceKey("event", matter, day),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return HerdrAskUnreported, err
		}
		if reminded {
			return HerdrAskAllowed, nil
		}
		woken, err := queries.CountProactiveRemindedEvents(ctx, store.CountProactiveRemindedEventsParams{
			TenantID: owner.TenantID, OwnerActorID: owner.ActorID,
		})
		if err != nil {
			return HerdrAskUnreported, err
		}
		if gated(now, woken) {
			return HerdrAskGated, nil
		}
		return HerdrAskAllowed, nil
	}
	return HerdrAskUnreported, nil
}
