package herdr

import (
	"context"
	"errors"
	"log/slog"
	"maps"
	"slices"
	"time"
	"unicode/utf8"
)

// Event kinds: an agent waiting at an approval or question, and an agent that
// finished a piece of work and is idle or done.
const (
	EventBlocked  = "agent_blocked"
	EventFinished = "agent_finished"
)

// Event is one moment of an agent pane that may need the user.
type Event struct {
	Kind           string
	PaneID         string
	StateChangeSeq uint64
	Agent          string
	Name           string
	Cwd            string
	Title          string
	Tail           string
}

const (
	tailLines    = 40
	settle       = 200 * time.Millisecond
	retryInitial = 2 * time.Second
	retryMax     = time.Minute
)

// errPanesChanged ends one subscription so the next one covers the new panes.
var errPanesChanged = errors.New("herdr agent panes changed")

// Watch reports agent panes that become blocked or finish until ctx ends. It
// emits only transitions it saw: what panes are doing when the watch starts,
// or when herdr comes back, is the baseline. A failed emit drops the event.
func Watch(ctx context.Context, client *Client, emit func(context.Context, Event) error) error {
	watcher := &watcher{client: client, emit: emit}
	delay := retryInitial
	for {
		err := watcher.subscribeOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if errors.Is(err, errPanesChanged) {
			delay = retryInitial
			continue
		}
		// herdr stopped or is not running: its pane IDs and counters may
		// restart, so the next server is a new baseline.
		if watcher.previous != nil {
			slog.Info("herdr.watch_stopped", "error", err)
		}
		watcher.previous = nil
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		delay = min(delay*2, retryMax)
	}
}

type watcher struct {
	client   *Client
	emit     func(context.Context, Event) error
	previous map[string]Agent
}

// subscribeOnce subscribes to the current panes' status changes and refreshes
// on every event, until the stream ends or the set of agent panes changes.
func (w *watcher) subscribeOnce(ctx context.Context) error {
	panes, err := w.refresh(ctx)
	if err != nil {
		return err
	}
	subscriptions := []map[string]any{{"type": "pane.agent_detected"}, {"type": "pane.closed"}}
	for _, pane := range panes {
		subscriptions = append(subscriptions, map[string]any{"type": "pane.agent_status_changed", "pane_id": pane})
	}
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	wake := make(chan struct{}, 1)
	ended := make(chan error, 1)
	go func() {
		// The confirmation is a wake too: a change between the list above and
		// the subscription is picked up by the refresh it triggers.
		ended <- w.client.subscribe(streamCtx, subscriptions, func() {
			select {
			case wake <- struct{}{}:
			default:
			}
		})
	}()
	for {
		select {
		case err := <-ended:
			return err
		case <-wake:
		}
		// One refresh covers a burst of events.
		timer := time.NewTimer(settle)
		select {
		case err := <-ended:
			timer.Stop()
			return err
		case <-timer.C:
		}
		current, err := w.refresh(ctx)
		if err != nil {
			return err
		}
		if !slices.Equal(current, panes) {
			return errPanesChanged
		}
	}
}

// refresh lists the agents, emits what changed since the last list and
// returns the sorted agent panes.
func (w *watcher) refresh(ctx context.Context) ([]string, error) {
	listCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	agents, err := w.client.Agents(listCtx)
	cancel()
	if err != nil {
		return nil, err
	}
	current := make(map[string]Agent, len(agents))
	for _, agent := range agents {
		current[agent.PaneID] = agent
	}
	events := Transitions(w.previous, current)
	w.previous = current
	for _, event := range events {
		tailCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		if tail, err := w.client.Tail(tailCtx, event.PaneID, tailLines); err == nil {
			event.Tail = Redact(tail)
		}
		cancel()
		if err := w.emit(ctx, event); err != nil {
			slog.Warn("herdr.event_dropped", "pane_id", event.PaneID, "kind", event.Kind, "error", err)
		}
	}
	return slices.Sorted(maps.Keys(current)), nil
}

// Transitions are the moments between two lists that may need the user: a
// pane that entered a new blocked state, and a pane whose agent completed new
// work. Completion is herdr's own counter, so work that finished between two
// lists is still seen when the pane passed through other states in between.
// Without a previous list there is no transition.
func Transitions(previous, current map[string]Agent) []Event {
	if previous == nil {
		return nil
	}
	var events []Event
	for _, pane := range slices.Sorted(maps.Keys(current)) {
		agent := current[pane]
		before, seen := previous[pane]
		var kind string
		switch {
		case agent.Status == "blocked" && (!seen || before.Status != "blocked" || before.StateChangeSeq != agent.StateChangeSeq):
			kind = EventBlocked
		case seen && agent.CompletionSeq != nil && (before.CompletionSeq == nil || *before.CompletionSeq != *agent.CompletionSeq):
			kind = EventFinished
		default:
			continue
		}
		events = append(events, Event{
			Kind: kind, PaneID: agent.PaneID, StateChangeSeq: agent.StateChangeSeq,
			Agent: clip(firstNonEmpty(agent.DisplayAgent, agent.Agent), 120), Name: clip(agent.Name, 120),
			Cwd: clip(firstNonEmpty(agent.ForegroundCwd, agent.Cwd), 4096), Title: clip(firstNonEmpty(agent.Title, agent.TerminalTitle), 500),
		})
	}
	return events
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func clip(value string, runes int) string {
	if utf8.RuneCountInString(value) <= runes {
		return value
	}
	count := 0
	for index := range value {
		if count == runes {
			return value[:index]
		}
		count++
	}
	return value
}
