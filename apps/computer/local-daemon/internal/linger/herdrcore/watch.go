package herdrcore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Event kinds emitted by Watch when a herdr-core terminal reaches a moment
// that may need user attention.
const (
	EventBlocked  = "agent_blocked"
	EventFinished = "agent_finished"
	EventError    = "agent_error"
)

// Answer delivery outcomes. Only AnswerSent means input reached the terminal.
const (
	AnswerSent               = "ok"
	AnswerTerminalClosed     = "terminal_closed"
	AnswerTerminalNotBlocked = "terminal_not_blocked"
	AnswerUnavailable        = "herdr_core_unavailable"
	AnswerInvalid            = "invalid_answer"
)

// Event is one structured herdr-core terminal transition emitted by Watch.
type Event struct {
	Kind     string
	Address  string
	Name     string
	Template string
	Agent    string
	Cwd      string
	Title    string
	Status   *Status
	Turn     uint64
	StatusMS *uint64
	Labels   map[string]string
	Tail     string
}

// WatchOptions tunes event filtering, coalescing, tail reads, and reconnect
// backoff for WatchWithOptions. Zero values select production defaults.
type WatchOptions struct {
	Filter       EventsSubscribeParams
	TailLines    uint
	Settle       time.Duration
	RetryInitial time.Duration
	RetryMax     time.Duration
	ReadTimeout  time.Duration
	// DisableSettle emits transitions immediately without coalescing delay.
	DisableSettle bool
}

const (
	defaultTailLines    uint = 40
	defaultSettle            = 100 * time.Millisecond
	defaultRetryInitial      = 2 * time.Second
	defaultRetryMax          = time.Minute
	defaultReadTimeout       = 5 * time.Second
)

func (o WatchOptions) normalized() WatchOptions {
	if o.TailLines == 0 {
		o.TailLines = defaultTailLines
	}
	if !o.DisableSettle && o.Settle <= 0 {
		o.Settle = defaultSettle
	}
	if o.DisableSettle {
		o.Settle = 0
	}
	if o.RetryInitial <= 0 {
		o.RetryInitial = defaultRetryInitial
	}
	if o.RetryMax <= 0 {
		o.RetryMax = defaultRetryMax
	}
	if o.RetryMax < o.RetryInitial {
		o.RetryMax = o.RetryInitial
	}
	if o.ReadTimeout <= 0 {
		o.ReadTimeout = defaultReadTimeout
	}
	return o
}

// AnswerText delivers a free-text answer to a live terminal that is still
// blocked on expectedTurn.
//
// In herdr-core v0.1.21, `terminal.send`'s `if` parameter only accepts "idle"
// or "working" (passing "blocked" returns invalid_params), so this method
// verifies live + blocked + exact turn via `terminal.get` and then dispatches
// `terminal.send` with `force: true`. An unexpected transport error after the
// pre-check returns a non-nil error so callers mark outcome_unknown and never
// double-type.
func (c *Client) AnswerText(ctx context.Context, address string, expectedTurn uint64, text string) (string, error) {
	address = strings.TrimSpace(address)
	if address == "" || strings.TrimSpace(text) == "" || strings.ContainsFunc(text, unicode.IsControl) {
		return AnswerInvalid, nil
	}
	status, ok := c.verifyBlockedTurn(ctx, address, expectedTurn)
	if !ok {
		return status, nil
	}
	if _, err := c.TerminalSend(ctx, TerminalSendParams{
		Terminal: address,
		Text:     text,
		Force:    true,
	}); err != nil {
		if preDispatch := classifyPostCheckRejection(err); preDispatch != "" {
			return preDispatch, nil
		}
		return "", fmt.Errorf("send herdr-core answer text: %w", err)
	}
	return AnswerSent, nil
}

// AnswerKeys presses named keys into a live terminal that is still blocked on
// expectedTurn (for example ["down", "enter"] or ["y", "enter"]).
func (c *Client) AnswerKeys(ctx context.Context, address string, expectedTurn uint64, keys []string) (string, error) {
	address = strings.TrimSpace(address)
	if address == "" || len(keys) == 0 {
		return AnswerInvalid, nil
	}
	cleaned := make([]string, len(keys))
	for index, key := range keys {
		if strings.ContainsFunc(key, unicode.IsControl) {
			return AnswerInvalid, nil
		}
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			return AnswerInvalid, nil
		}
		cleaned[index] = trimmed
	}
	status, ok := c.verifyBlockedTurn(ctx, address, expectedTurn)
	if !ok {
		return status, nil
	}
	if _, err := c.TerminalKeys(ctx, TerminalKeysParams{
		Terminal: address,
		Keys:     cleaned,
	}); err != nil {
		if preDispatch := classifyPostCheckRejection(err); preDispatch != "" {
			return preDispatch, nil
		}
		return "", fmt.Errorf("send herdr-core answer keys: %w", err)
	}
	return AnswerSent, nil
}

func (c *Client) verifyBlockedTurn(ctx context.Context, address string, expectedTurn uint64) (string, bool) {
	terminal, err := c.TerminalGet(ctx, TerminalGetParams{Terminal: address})
	if err != nil {
		return classifyReadFailure(err), false
	}
	if terminal.State != TerminalStateLive {
		return AnswerTerminalClosed, false
	}
	if terminal.Status == nil || terminal.Status.State != StatusBlocked || terminal.Turn != expectedTurn {
		return AnswerTerminalNotBlocked, false
	}
	return "", true
}

func classifyReadFailure(err error) string {
	switch ErrorKind(err) {
	case ErrKindNotFound, ErrKindMachineUnknown, ErrKindFinished:
		return AnswerTerminalClosed
	default:
		var hcErr *Error
		if errors.As(err, &hcErr) {
			return AnswerTerminalClosed
		}
		return AnswerUnavailable
	}
}

func classifyPostCheckRejection(err error) string {
	switch ErrorKind(err) {
	case ErrKindNotFound, ErrKindMachineUnknown, ErrKindFinished:
		return AnswerTerminalClosed
	case ErrKindBlocked, ErrKindStatusMismatch:
		return AnswerTerminalNotBlocked
	default:
		return ""
	}
}

// Watch subscribes to herdr-core's `events.subscribe` stream and emits
// structured agent_blocked, agent_finished, and agent_error transitions until
// ctx is canceled. Initial snapshot states establish the baseline and are not
// emitted.
func Watch(ctx context.Context, client *Client, emit func(context.Context, Event) error) error {
	return WatchWithOptions(ctx, client, WatchOptions{}, emit)
}

// WatchWithOptions runs Watch with custom WatchOptions.
func WatchWithOptions(ctx context.Context, client *Client, options WatchOptions, emit func(context.Context, Event) error) error {
	opts := options.normalized()
	w := &watcher{
		client: client,
		opts:   opts,
		emit:   emit,
	}
	delay := opts.RetryInitial
	for {
		connected, err := w.subscribeOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if connected {
			delay = opts.RetryInitial
			slog.Info("herdrcore.watch_stopped", "error", err)
		}
		w.reset()
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		delay = min(delay*2, opts.RetryMax)
	}
}

type emittedWatermark struct {
	blockedSignature string
	errorSignature   string
	finishedTurn     uint64
	finishedDoneKey  string
}

type watcher struct {
	client   *Client
	opts     WatchOptions
	emit     func(context.Context, Event) error
	baseline map[string]Terminal
	current  map[string]Terminal
	emitted  map[string]emittedWatermark
	lastSeq  uint64
}

func (w *watcher) reset() {
	w.baseline = nil
	w.current = nil
	w.emitted = nil
	w.lastSeq = 0
}

type streamPacket struct {
	msg StreamMessage
	err error
}

func (w *watcher) subscribeOnce(ctx context.Context) (bool, error) {
	subCtx, cancelSub := context.WithTimeout(ctx, w.opts.ReadTimeout)
	stream, err := w.client.EventsSubscribe(subCtx, w.opts.Filter)
	cancelSub()
	if err != nil {
		return false, err
	}
	defer stream.Close()

	w.initSnapshot(stream.Snapshot.Seq, stream.Snapshot.Terminals)

	streamCtx, cancelStream := context.WithCancel(ctx)
	defer cancelStream()
	packets := make(chan streamPacket, 32)
	go func() {
		for {
			msg, nextErr := stream.Next(streamCtx)
			select {
			case packets <- streamPacket{msg: msg, err: nextErr}:
			case <-streamCtx.Done():
				return
			}
			if nextErr != nil {
				return
			}
		}
	}()

	dirty := make(map[string]bool)
	var settleTimer *time.Timer
	var settleCh <-chan time.Time
	stopSettle := func() {
		if settleTimer != nil {
			settleTimer.Stop()
			settleTimer = nil
		}
		settleCh = nil
	}
	defer stopSettle()

	flushDirty := func() {
		stopSettle()
		if len(dirty) == 0 {
			return
		}
		addresses := slices.Sorted(maps.Keys(dirty))
		clear(dirty)
		w.reconcileAddresses(ctx, addresses)
	}

	for {
		select {
		case <-ctx.Done():
			return true, ctx.Err()
		case <-settleCh:
			flushDirty()
		case packet := <-packets:
			if packet.err != nil {
				return true, packet.err
			}
			switch packet.msg.Kind {
			case StreamMessageHeartbeat:
				continue
			case StreamMessageMissed:
				stopSettle()
				clear(dirty)
				if err := w.handleMissed(ctx, packet.msg.Missed); err != nil {
					return true, err
				}
			case StreamMessageEvent:
				if packet.msg.Event == nil {
					continue
				}
				address, interesting := w.applyEvent(*packet.msg.Event)
				if interesting && address != "" {
					dirty[address] = true
					if w.opts.Settle <= 0 {
						flushDirty()
					} else if settleTimer == nil {
						settleTimer = time.NewTimer(w.opts.Settle)
						settleCh = settleTimer.C
					}
				}
			}
		}
	}
}

func (w *watcher) initSnapshot(seq uint64, terminals []Terminal) {
	w.baseline = make(map[string]Terminal, len(terminals))
	w.current = make(map[string]Terminal, len(terminals))
	w.emitted = make(map[string]emittedWatermark, len(terminals))
	for _, terminal := range terminals {
		cloned := cloneTerminal(terminal)
		w.baseline[terminal.Address] = cloned
		w.current[terminal.Address] = cloneTerminal(terminal)
		w.emitted[terminal.Address] = seedWatermark(terminal)
	}
	w.lastSeq = seq
}

func (w *watcher) handleMissed(ctx context.Context, missed *MissedNotification) error {
	var freshList []Terminal
	var seq uint64
	if missed != nil {
		seq = missed.Seq
		freshList = missed.Terminals
	}
	if freshList == nil {
		listCtx, cancel := context.WithTimeout(ctx, w.opts.ReadTimeout)
		listed, err := w.client.TerminalList(listCtx, TerminalListParams{
			All:    false,
			Labels: w.opts.Filter.Labels,
		})
		cancel()
		if err != nil {
			return err
		}
		freshList = listed.Terminals
	}
	if seq > w.lastSeq {
		w.lastSeq = seq
	}
	freshMap := make(map[string]Terminal, len(freshList))
	for _, terminal := range freshList {
		freshMap[terminal.Address] = cloneTerminal(terminal)
	}
	events := Transitions(w.baseline, freshMap)
	w.current = cloneTerminalMap(freshMap)
	w.baseline = cloneTerminalMap(freshMap)
	for _, event := range events {
		terminal := freshMap[event.Address]
		if !w.shouldEmit(event.Address, event.Kind, terminal) {
			continue
		}
		w.attachTailAndEmit(ctx, event)
		w.recordEmitted(event.Address, event.Kind, terminal)
	}
	for address, terminal := range freshMap {
		if _, ok := w.emitted[address]; !ok {
			w.emitted[address] = seedWatermark(terminal)
		}
	}
	for address := range w.emitted {
		if _, ok := freshMap[address]; !ok {
			delete(w.emitted, address)
		}
	}
	return nil
}

func (w *watcher) applyEvent(ev EventNotification) (string, bool) {
	if ev.Seq > 0 && ev.Seq <= w.lastSeq {
		return "", false
	}
	if ev.Seq > w.lastSeq {
		w.lastSeq = ev.Seq
	}
	address := ev.Terminal
	switch ev.Type {
	case "created":
		var created Terminal
		if json.Unmarshal(ev.Data, &created) == nil && created.Address != "" {
			if address == "" {
				address = created.Address
			}
			w.current[address] = cloneTerminal(created)
			return address, created.Status != nil && (created.Status.State == StatusBlocked || created.Status.State == StatusError)
		}
	case "status":
		var data StatusEventData
		if json.Unmarshal(ev.Data, &data) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.Status = cloneStatus(data.Status)
			if data.StatusMS != nil {
				v := *data.StatusMS
				terminal.StatusMS = &v
			}
			if data.Reported != nil {
				terminal.Reported = *data.Reported
			}
			if data.Records != nil {
				terminal.Records = maps.Clone(data.Records)
			}
			w.current[address] = terminal
			return address, true
		}
	case "turn":
		var data TurnEventData
		if json.Unmarshal(ev.Data, &data) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.Turn = data.Turn
			if data.State != "" {
				if terminal.Status == nil {
					terminal.Status = &Status{State: data.State}
				} else {
					terminal.Status.State = data.State
				}
			}
			w.current[address] = terminal
			return address, true
		}
	case "title":
		var data TitleEventData
		if json.Unmarshal(ev.Data, &data) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.Title = data.Title
			w.current[address] = terminal
		}
	case "labels":
		var data LabelsEventData
		if json.Unmarshal(ev.Data, &data) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.Labels = maps.Clone(data.Labels)
			w.current[address] = terminal
		}
	case "foreground":
		var fg Foreground
		if json.Unmarshal(ev.Data, &fg) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.Foreground = &fg
			w.current[address] = terminal
		}
	case "size":
		var data SizeEventData
		if json.Unmarshal(ev.Data, &data) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.Cols = data.Cols
			terminal.Rows = data.Rows
			w.current[address] = terminal
		}
	case "keep":
		var data KeepEventData
		if json.Unmarshal(ev.Data, &data) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.Keep = data.Keep
			w.current[address] = terminal
		}
	case "finished":
		var data FinishedEventData
		if json.Unmarshal(ev.Data, &data) == nil && address != "" {
			terminal := w.ensureTerminal(address)
			terminal.State = TerminalStateFinished
			terminal.ExitCode = data.ExitCode
			terminal.FinishedMS = data.FinishedMS
			terminal.Reason = data.Reason
			terminal.Signal = data.Signal
			terminal.Status = nil
			w.current[address] = terminal
			w.baseline[address] = cloneTerminal(terminal)
		}
	case "removed":
		if address != "" {
			delete(w.current, address)
			delete(w.baseline, address)
			delete(w.emitted, address)
		}
	}
	return address, false
}

func (w *watcher) ensureTerminal(address string) Terminal {
	if existing, ok := w.current[address]; ok {
		return existing
	}
	return Terminal{Address: address, State: TerminalStateLive}
}

func (w *watcher) reconcileAddresses(ctx context.Context, addresses []string) {
	for _, address := range addresses {
		cached, ok := w.current[address]
		if !ok {
			continue
		}
		authoritative := cached
		getCtx, cancel := context.WithTimeout(ctx, w.opts.ReadTimeout)
		fetched, err := w.client.TerminalGet(getCtx, TerminalGetParams{Terminal: address})
		cancel()
		if err == nil {
			authoritative = cloneTerminal(fetched)
			w.current[address] = cloneTerminal(fetched)
		} else if IsErrorKind(err, ErrKindNotFound) {
			delete(w.current, address)
			delete(w.baseline, address)
			delete(w.emitted, address)
			continue
		}

		before, seen := w.baseline[address]
		var prevMap map[string]Terminal
		if seen {
			prevMap = map[string]Terminal{address: before}
		} else {
			prevMap = map[string]Terminal{}
		}
		events := Transitions(prevMap, map[string]Terminal{address: authoritative})
		w.baseline[address] = cloneTerminal(authoritative)
		w.clearStaleWatermarks(address, authoritative)
		for _, event := range events {
			if !w.shouldEmit(address, event.Kind, authoritative) {
				continue
			}
			w.attachTailAndEmit(ctx, event)
			w.recordEmitted(address, event.Kind, authoritative)
		}
	}
}

func (w *watcher) clearStaleWatermarks(address string, terminal Terminal) {
	wm, ok := w.emitted[address]
	if !ok {
		return
	}
	if terminal.Status == nil || terminal.Status.State != StatusBlocked {
		wm.blockedSignature = ""
	}
	if terminal.Status == nil || terminal.Status.State != StatusError {
		wm.errorSignature = ""
	}
	w.emitted[address] = wm
}

func (w *watcher) attachTailAndEmit(ctx context.Context, event Event) {
	readCtx, cancel := context.WithTimeout(ctx, w.opts.ReadTimeout)
	if readResult, err := w.client.TerminalRead(readCtx, TerminalReadParams{
		Terminal: event.Address,
		Lines:    w.opts.TailLines,
	}); err == nil {
		event.Tail = Redact(readResult.Text)
	}
	cancel()
	if err := w.emit(ctx, event); err != nil {
		slog.Warn("herdrcore.event_dropped", "address", event.Address, "kind", event.Kind, "error", err)
	}
}

func (w *watcher) shouldEmit(address, kind string, terminal Terminal) bool {
	wm := w.emitted[address]
	switch kind {
	case EventBlocked:
		return statusSignature(terminal) != wm.blockedSignature
	case EventError:
		return statusSignature(terminal) != wm.errorSignature
	case EventFinished:
		if terminal.Turn > wm.finishedTurn {
			return true
		}
		return terminal.Status != nil && terminal.Status.State == StatusDone && statusSignature(terminal) != wm.finishedDoneKey
	default:
		return true
	}
}

func (w *watcher) recordEmitted(address, kind string, terminal Terminal) {
	wm := w.emitted[address]
	switch kind {
	case EventBlocked:
		wm.blockedSignature = statusSignature(terminal)
	case EventError:
		wm.errorSignature = statusSignature(terminal)
	case EventFinished:
		if terminal.Turn > wm.finishedTurn {
			wm.finishedTurn = terminal.Turn
		}
		if terminal.Status != nil && terminal.Status.State == StatusDone {
			wm.finishedDoneKey = statusSignature(terminal)
		}
	}
	w.emitted[address] = wm
}

func seedWatermark(terminal Terminal) emittedWatermark {
	wm := emittedWatermark{finishedTurn: terminal.Turn}
	if terminal.Status != nil {
		switch terminal.Status.State {
		case StatusBlocked:
			wm.blockedSignature = statusSignature(terminal)
		case StatusError:
			wm.errorSignature = statusSignature(terminal)
		case StatusDone:
			wm.finishedDoneKey = statusSignature(terminal)
		}
	}
	return wm
}

func statusSignature(terminal Terminal) string {
	var state, kind, msg string
	if terminal.Status != nil {
		state = terminal.Status.State
		if terminal.Status.Kind != nil {
			kind = *terminal.Status.Kind
		}
		msg = terminal.Status.Msg
	}
	var statusMS uint64
	if terminal.StatusMS != nil {
		statusMS = *terminal.StatusMS
	}
	return fmt.Sprintf("%s|%d|%d|%s|%s", state, terminal.Turn, statusMS, kind, msg)
}

// Transitions computes structured Linger transitions between two terminal
// snapshots: new blocked states, newly completed work, and new error states.
// Without a previous snapshot (previous == nil) there is no transition.
func Transitions(previous, current map[string]Terminal) []Event {
	if previous == nil {
		return nil
	}
	var events []Event
	for _, address := range slices.Sorted(maps.Keys(current)) {
		terminal := current[address]
		if terminal.State != TerminalStateLive || terminal.Status == nil {
			continue
		}
		before, seen := previous[address]
		var beforeState string
		if seen && before.Status != nil {
			beforeState = before.Status.State
		}
		var kind string
		switch terminal.Status.State {
		case StatusBlocked:
			if !seen || beforeState != StatusBlocked || statusSignature(before) != statusSignature(terminal) {
				kind = EventBlocked
			}
		case StatusError:
			if !seen || beforeState != StatusError || statusSignature(before) != statusSignature(terminal) {
				kind = EventError
			}
		case StatusDone:
			if seen && (before.Turn != terminal.Turn || beforeState != StatusDone) {
				kind = EventFinished
			}
		case StatusIdle:
			// Idle with an increased turn means work completed; a fresh idle terminal is not news.
			if seen && terminal.Turn > before.Turn {
				kind = EventFinished
			}
		}
		if kind == "" {
			continue
		}
		events = append(events, buildEvent(kind, terminal))
	}
	return events
}

func buildEvent(kind string, terminal Terminal) Event {
	var name, template, fgName, fgCwd string
	if terminal.Name != nil {
		name = *terminal.Name
	}
	if terminal.Template != nil {
		template = *terminal.Template
	}
	if terminal.Foreground != nil {
		fgName = terminal.Foreground.Name
		fgCwd = terminal.Foreground.Cwd
	}
	var statusApp, statusTitle string
	if terminal.Status != nil {
		statusApp = terminal.Status.App
		statusTitle = terminal.Status.Title
	}
	var statusMS *uint64
	if terminal.StatusMS != nil {
		value := *terminal.StatusMS
		statusMS = &value
	}
	return Event{
		Kind:     kind,
		Address:  terminal.Address,
		Name:     clip(name, 120),
		Template: clip(template, 120),
		Agent:    clip(firstNonEmpty(statusApp, template, fgName), 120),
		Cwd:      clip(firstNonEmpty(fgCwd, terminal.Cwd), 4096),
		Title:    clip(firstNonEmpty(statusTitle, terminal.Title), 500),
		Status:   cloneStatus(terminal.Status),
		Turn:     terminal.Turn,
		StatusMS: statusMS,
		Labels:   maps.Clone(terminal.Labels),
	}
}

func cloneStatus(status *Status) *Status {
	if status == nil {
		return nil
	}
	copied := *status
	if status.Kind != nil {
		v := *status.Kind
		copied.Kind = &v
	}
	if status.Progress != nil {
		v := *status.Progress
		copied.Progress = &v
	}
	return &copied
}

func cloneTerminal(terminal Terminal) Terminal {
	copied := terminal
	copied.Argv = slices.Clone(terminal.Argv)
	copied.Labels = maps.Clone(terminal.Labels)
	copied.Records = maps.Clone(terminal.Records)
	copied.Status = cloneStatus(terminal.Status)
	if terminal.Foreground != nil {
		fg := *terminal.Foreground
		fg.Argv = slices.Clone(fg.Argv)
		copied.Foreground = &fg
	}
	if terminal.StatusMS != nil {
		v := *terminal.StatusMS
		copied.StatusMS = &v
	}
	return copied
}

func cloneTerminalMap(source map[string]Terminal) map[string]Terminal {
	cloned := make(map[string]Terminal, len(source))
	for k, v := range source {
		cloned[k] = cloneTerminal(v)
	}
	return cloned
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func clip(value string, maxRunes int) string {
	if utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	count := 0
	for index := range value {
		if count == maxRunes {
			return value[:index]
		}
		count++
	}
	return value
}
