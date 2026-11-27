package proactive

import (
	"context"
	"errors"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/realtime"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// herdr-core events: a coding agent or terminal managed by herdr-core (hc) on
// the Human's Local Computer or one of its remote machines.
const (
	SourceHerdrCore          = "herdr_core"
	HerdrCoreAgentBlocked    = "agent_blocked"
	HerdrCoreAgentFinished   = "agent_finished"
	HerdrCoreAgentError      = "agent_error"
	HerdrCoreTerminalChanged = "terminal_changed"
)

// Standard Linger and Herdr terminal label keys.
const (
	HerdrCoreLabelRoom     = "linger.room"
	HerdrCoreLabelWorkItem = "linger.work_item"
	HerdrCoreLabelAgent    = "linger.agent"
	HerdrCoreLabelOrigin   = "linger.origin"
	HerdrCoreLabelSpace    = "herdr.space"
	HerdrCoreLabelTab      = "herdr.tab"
)

// HerdrCoreStatus mirrors the OSC 7501 status attached to a herdr-core terminal.
type HerdrCoreStatus struct {
	State    string   `json:"state"`
	App      string   `json:"app,omitempty"`
	Msg      string   `json:"msg,omitempty"`
	Progress *float64 `json:"progress,omitempty"`
	Title    string   `json:"title,omitempty"`
}

// HerdrCoreTerminalRef identifies one herdr-core terminal state and its
// matchable My Rules attributes (machine, cwd, app, labels).
type HerdrCoreTerminalRef struct {
	Address  string            `json:"address"`
	Machine  string            `json:"machine,omitempty"`
	Turn     int64             `json:"turn"`
	StatusMs int64             `json:"status_ms"`
	App      string            `json:"app,omitempty"`
	Cwd      string            `json:"cwd,omitempty"`
	Labels   map[string]string `json:"labels,omitempty"`
}

// HerdrCoreReport is what a Local Computer reported about one of its herdr-core
// terminals via runner.herdr_core_event.
type HerdrCoreReport struct {
	ComputerID string
	Kind       string
	Address    string
	Machine    string
	Turn       int64
	StatusMs   int64
	Status     *HerdrCoreStatus
	Name       string
	Cwd        string
	Title      string
	Template   string
	Parent     string
	Labels     map[string]string
	Tail       string
}

// App returns the OSC 7501 app name when present, falling back to template.
func (r HerdrCoreReport) App() string {
	if r.Status != nil && strings.TrimSpace(r.Status.App) != "" {
		return strings.TrimSpace(r.Status.App)
	}
	return strings.TrimSpace(r.Template)
}

// HerdrCoreRuleCondition filters when a My Rules entry applies to a herdr-core
// proactive event. Empty fields match any value.
type HerdrCoreRuleCondition struct {
	Machine string            `json:"machine,omitempty"`
	Cwd     string            `json:"cwd,omitempty"`
	App     string            `json:"app,omitempty"`
	Labels  map[string]string `json:"labels,omitempty"`
}

// Empty reports whether the condition constrains no herdr-core attributes.
func (c *HerdrCoreRuleCondition) Empty() bool {
	if c == nil {
		return true
	}
	return strings.TrimSpace(c.Machine) == "" &&
		strings.TrimSpace(c.Cwd) == "" &&
		strings.TrimSpace(c.App) == "" &&
		len(c.Labels) == 0
}

// Normalize trims and validates a HerdrCoreRuleCondition. It returns nil when
// all fields are empty.
func (c *HerdrCoreRuleCondition) Normalize() (*HerdrCoreRuleCondition, error) {
	if c == nil {
		return nil, nil
	}
	machine := strings.TrimSpace(c.Machine)
	cwd := strings.TrimSpace(c.Cwd)
	app := strings.TrimSpace(c.App)
	if utf8.RuneCountInString(machine) > 128 ||
		utf8.RuneCountInString(cwd) > 4096 ||
		utf8.RuneCountInString(app) > 120 ||
		len(c.Labels) > 32 {
		return nil, ErrInvalidRule
	}
	var labels map[string]string
	if len(c.Labels) > 0 {
		labels = make(map[string]string, len(c.Labels))
		for rawKey, rawValue := range c.Labels {
			key := strings.TrimSpace(rawKey)
			value := strings.TrimSpace(rawValue)
			if key == "" || utf8.RuneCountInString(key) > 128 || value == "" || utf8.RuneCountInString(value) > 256 {
				return nil, ErrInvalidRule
			}
			labels[key] = value
		}
	}
	normalized := &HerdrCoreRuleCondition{
		Machine: machine,
		Cwd:     cwd,
		App:     app,
		Labels:  labels,
	}
	if normalized.Empty() {
		return nil, nil
	}
	return normalized, nil
}

// MatchHerdrCoreCondition reports whether a herdr-core terminal state matches
// every non-empty attribute constraint in cond.
func MatchHerdrCoreCondition(cond *HerdrCoreRuleCondition, ref HerdrCoreTerminalRef) bool {
	if cond == nil || cond.Empty() {
		return true
	}
	if machine := strings.TrimSpace(cond.Machine); machine != "" {
		actual := strings.TrimSpace(ref.Machine)
		if strings.EqualFold(machine, "local") {
			if actual != "" && !strings.EqualFold(actual, "local") {
				return false
			}
		} else if !matchWildcard(strings.ToLower(machine), strings.ToLower(actual)) {
			return false
		}
	}
	if cwd := strings.TrimSpace(cond.Cwd); cwd != "" {
		actualCwd := strings.TrimSpace(ref.Cwd)
		if actualCwd == "" {
			return false
		}
		if strings.Contains(cwd, "*") {
			if !matchWildcard(cwd, actualCwd) {
				return false
			}
		} else {
			cleanCond := strings.TrimRight(path.Clean(cwd), "/")
			cleanActual := strings.TrimRight(path.Clean(actualCwd), "/")
			if cleanCond == "" {
				cleanCond = "/"
			}
			if cleanActual != cleanCond && !strings.HasPrefix(cleanActual, cleanCond+"/") {
				return false
			}
		}
	}
	if app := strings.TrimSpace(cond.App); app != "" {
		actualApp := strings.TrimSpace(ref.App)
		if actualApp == "" || !matchWildcard(strings.ToLower(app), strings.ToLower(actualApp)) {
			return false
		}
	}
	for key, want := range cond.Labels {
		got, exists := ref.Labels[key]
		if !exists || strings.TrimSpace(got) == "" {
			return false
		}
		if want != "*" && !matchWildcard(want, got) {
			return false
		}
	}
	return true
}

// matchWildcard performs simple '*' wildcard matching across arbitrary strings
// (including paths containing '/').
func matchWildcard(pattern, value string) bool {
	if pattern == "*" {
		return true
	}
	if !strings.Contains(pattern, "*") {
		return pattern == value
	}
	parts := strings.Split(pattern, "*")
	if !strings.HasPrefix(value, parts[0]) {
		return false
	}
	rest := value[len(parts[0]):]
	last := parts[len(parts)-1]
	if !strings.HasSuffix(rest, last) {
		return false
	}
	rest = rest[:len(rest)-len(last)]
	for _, middle := range parts[1 : len(parts)-1] {
		if middle == "" {
			continue
		}
		idx := strings.Index(rest, middle)
		if idx < 0 {
			return false
		}
		rest = rest[idx+len(middle):]
	}
	return true
}

// EnqueueHerdrCoreEvent records a herdr-core report from an enrolled Local
// Computer. Every valid event broadcasts a real-time herdr-core SSE
// invalidation hint for the owner's Tenant; agent_blocked, agent_finished, and
// agent_error transitions are also queued for proactive judgment.
func (s *Service) EnqueueHerdrCoreEvent(ctx context.Context, report HerdrCoreReport) error {
	if !validHerdrCoreEventKind(report.Kind) || strings.TrimSpace(report.Address) == "" || report.Turn < 0 || report.StatusMs < 0 {
		return ErrInvalidEvent
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := store.New(tx)
	computer, err := queries.GetAgentRuntimeLocalComputer(ctx, report.ComputerID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && computer.RemovedAt.Valid {
		return ErrUnknownComputer
	}
	if err != nil {
		return err
	}
	if err := realtime.Invalidate(ctx, queries, realtime.Invalidation{
		TenantID: computer.OwnerTenantID,
		Resource: realtime.InvalidateHerdrCore,
		ID:       report.ComputerID,
	}); err != nil {
		return err
	}
	if report.Kind != HerdrCoreTerminalChanged {
		if err := EnqueueEventTx(ctx, tx, HerdrCoreEvent(computer.OwnerTenantID, computer.OwnerActorID, report)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func validHerdrCoreEventKind(kind string) bool {
	return kind == HerdrCoreAgentBlocked ||
		kind == HerdrCoreAgentFinished ||
		kind == HerdrCoreAgentError ||
		kind == HerdrCoreTerminalChanged
}

// HerdrCoreEvent builds the proactive Event for a herdr-core report. Each
// (address, turn, status_ms) tuple names one terminal state so repeated reports
// are deduplicated while subsequent turns or status transitions are judged
// independently.
func HerdrCoreEvent(tenantID, ownerActorID string, report HerdrCoreReport) Event {
	what := "A coding agent is waiting for an answer"
	switch report.Kind {
	case HerdrCoreAgentFinished:
		what = "A coding agent finished its work"
	case HerdrCoreAgentError:
		what = "A coding agent reported an error"
	}
	machineLabel := strings.TrimSpace(report.Machine)
	if machineLabel == "" {
		machineLabel = "local"
	}
	app := report.App()
	statusLine := ""
	if report.Status != nil {
		statusLine = strings.TrimSpace(report.Status.State)
		if msg := strings.TrimSpace(report.Status.Msg); msg != "" {
			if statusLine != "" {
				statusLine += ": " + msg
			} else {
				statusLine = msg
			}
		}
	}
	labelSummary := formatHerdrCoreLabels(report.Labels)
	summary := summaryLines(
		[2]string{"What", what},
		[2]string{"Machine", machineLabel},
		[2]string{"Terminal", report.Address},
		[2]string{"App", app},
		[2]string{"Agent name", report.Name},
		[2]string{"Template", report.Template},
		[2]string{"Parent", report.Parent},
		[2]string{"Directory", report.Cwd},
		[2]string{"Title", report.Title},
		[2]string{"Status", statusLine},
		[2]string{"Labels", labelSummary},
		[2]string{"Last lines of the terminal", report.Tail},
	)
	state := herdrCoreStateKey(report.Turn, report.StatusMs)
	var copiedLabels map[string]string
	if len(report.Labels) > 0 {
		copiedLabels = make(map[string]string, len(report.Labels))
		for k, v := range report.Labels {
			copiedLabels[k] = v
		}
	}
	return Event{
		ComputerID:   report.ComputerID,
		TenantID:     tenantID,
		OwnerActorID: ownerActorID,
		Source:       SourceHerdrCore,
		Kind:         report.Kind,
		ExternalID:   herdrCoreExternalID(report.ComputerID, report.Address, report.Turn, report.StatusMs),
		State:        state,
		Summary:      summary,
		HerdrCore: &HerdrCoreTerminalRef{
			Address:  report.Address,
			Machine:  strings.TrimSpace(report.Machine),
			Turn:     report.Turn,
			StatusMs: report.StatusMs,
			App:      app,
			Cwd:      strings.TrimSpace(report.Cwd),
			Labels:   copiedLabels,
		},
	}
}

func herdrCoreExternalID(computerID, address string, turn, statusMs int64) string {
	return computerID + "/" + address + "/" + strconv.FormatInt(turn, 10) + "/" + strconv.FormatInt(statusMs, 10)
}

func herdrCoreStateKey(turn, statusMs int64) string {
	return strconv.FormatInt(turn, 10) + ":" + strconv.FormatInt(statusMs, 10)
}

func formatHerdrCoreLabels(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+labels[k])
	}
	return strings.Join(parts, ", ")
}

// HerdrCoreAskable reports whether a question card may be bound to this
// herdr-core terminal state (address, turn, status_ms) now.
func (s *Service) HerdrCoreAskable(ctx context.Context, owner Owner, computerID, address string, turn, statusMs int64) (HerdrAsk, error) {
	state := herdrCoreStateKey(turn, statusMs)
	matter := eventMatter(SourceHerdrCore, herdrCoreExternalID(computerID, address, turn, statusMs), state)
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
