package daemon

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/herdrcore"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

// serviceFeatureHerdrCoreV1 in runner.welcome's service_features says the Agent
// Service accepts runner.herdr_core_event frames and dispatches herdr_core
// control-plane calls. Older Agent Services close the connection on unknown frames.
const serviceFeatureHerdrCoreV1 = "herdr_core_v1"

// serviceFeatureHerdrCoreStream in runner.welcome's service_features says the
// Agent Service accepts outbound binary PTY attach WebSocket streams.
const serviceFeatureHerdrCoreStream = "herdr_core_stream"

// ownerHerdrCoreAgentID is the wire sentinel Agent ID Node Services sends for
// owner-scoped herdr_core REST and attach calls that do not require an Agent
// placement on this Computer.
const ownerHerdrCoreAgentID = "herdr-core"

const (
	herdrCoreMaxPutBytes  = 8 << 20
	herdrCoreMaxReadLines = 5000
	herdrCoreMaxKeys      = 128
	herdrCoreMaxLabels    = 32
	herdrCoreMaxCols      = 500
	herdrCoreMaxRows      = 200
)

// HerdrCoreClient is the subset of *herdrcore.Client the Local Computer Daemon
// uses for control-plane RPCs, answer delivery, and binary PTY attach streams.
type HerdrCoreClient interface {
	ServerStatus(ctx context.Context) (herdrcore.StatusResult, error)
	TemplatesList(ctx context.Context) (herdrcore.TemplatesResult, error)
	TerminalList(ctx context.Context, params herdrcore.TerminalListParams) (herdrcore.ListResult, error)
	TerminalGet(ctx context.Context, params herdrcore.TerminalGetParams) (herdrcore.Terminal, error)
	TerminalRead(ctx context.Context, params herdrcore.TerminalReadParams) (herdrcore.ReadResult, error)
	TerminalRun(ctx context.Context, params herdrcore.TerminalRunParams) (herdrcore.RunResult, error)
	TerminalSend(ctx context.Context, params herdrcore.TerminalSendParams) (herdrcore.SendResult, error)
	TerminalKeys(ctx context.Context, params herdrcore.TerminalKeysParams) (herdrcore.KeysResult, error)
	TerminalInterrupt(ctx context.Context, params herdrcore.TerminalInterruptParams) (herdrcore.InterruptResult, error)
	TerminalWait(ctx context.Context, params herdrcore.TerminalWaitParams) (herdrcore.WaitResult, error)
	TerminalKill(ctx context.Context, params herdrcore.TerminalKillParams) (herdrcore.Terminal, error)
	TerminalRemove(ctx context.Context, params herdrcore.TerminalRemoveParams) (herdrcore.RemoveResult, error)
	TerminalKeep(ctx context.Context, params herdrcore.TerminalKeepParams) (herdrcore.Terminal, error)
	TerminalLabel(ctx context.Context, params herdrcore.TerminalLabelParams) (herdrcore.Terminal, error)
	TerminalPut(ctx context.Context, params herdrcore.TerminalPutParams) (herdrcore.PutResult, error)
	MachineList(ctx context.Context) (herdrcore.MachineListResult, error)
	MachineExec(ctx context.Context, params herdrcore.MachineExecParams) (herdrcore.ExecResult, error)
	FileRead(ctx context.Context, params herdrcore.FileReadParams) (herdrcore.FileReadResult, error)
	FileWrite(ctx context.Context, params herdrcore.FileWriteParams) (herdrcore.FileResult, error)
	FileEdit(ctx context.Context, params herdrcore.FileEditParams) (herdrcore.FileResult, error)
	DocGet(ctx context.Context, params herdrcore.DocGetParams) (herdrcore.DocGetResult, error)
	DocSet(ctx context.Context, params herdrcore.DocSetParams) (herdrcore.DocSetResult, error)
	AnswerText(ctx context.Context, address string, expectedTurn uint64, text string) (string, error)
	AnswerKeys(ctx context.Context, address string, expectedTurn uint64, keys []string) (string, error)
	AttachWithOptions(ctx context.Context, params herdrcore.TerminalAttachParams, options herdrcore.AttachOptions) (*herdrcore.AttachSession, error)
}

var _ HerdrCoreClient = (*herdrcore.Client)(nil)

// HerdrCoreStreamTarget configures outbound binary PTY attach WebSocket dials.
// When empty, Daemon derives it from transport.GatewayControlPlane.
type HerdrCoreStreamTarget struct {
	URL         string
	BearerToken string
	Dialer      *websocket.Dialer
}

func resolveHerdrCoreStreamTarget(override HerdrCoreStreamTarget, controlPlane transport.ControlPlane) HerdrCoreStreamTarget {
	if override.URL != "" || override.BearerToken != "" || override.Dialer != nil {
		return override
	}
	switch gw := controlPlane.(type) {
	case transport.GatewayControlPlane:
		return HerdrCoreStreamTarget{URL: gw.URL, BearerToken: gw.BearerToken, Dialer: gw.Dialer}
	case *transport.GatewayControlPlane:
		if gw != nil {
			return HerdrCoreStreamTarget{URL: gw.URL, BearerToken: gw.BearerToken, Dialer: gw.Dialer}
		}
	}
	return HerdrCoreStreamTarget{}
}

// PublishHerdrCoreEvent reports a herdr-core terminal transition on the live
// Runner Gateway connection when runner.welcome advertised herdr_core_v1.
// Without herdr_core_v1 it returns nil without writing any frame so older Agent
// Services are never broken.
func (d *Daemon) PublishHerdrCoreEvent(ctx context.Context, event herdrcore.Event) error {
	d.connectionMu.Lock()
	stream := d.diagnosticsStream
	enabled := d.herdrCoreV1.Load()
	d.connectionMu.Unlock()
	if stream == nil {
		return errors.New("Runner Gateway is not connected")
	}
	if !enabled {
		return nil
	}
	wireEvent, ok := toWireHerdrCoreEvent(event)
	if !ok {
		return errors.New("invalid herdr-core event")
	}
	now := d.now
	if now == nil {
		now = time.Now
	}
	payload, err := json.Marshal(wire.RunnerHerdrCoreEvent{
		Type:            wire.TypeRunnerHerdrCoreEvent,
		ProtocolVersion: protocol.Version,
		RunnerID:        d.computerID,
		SentAt:          now().UTC().Format(time.RFC3339Nano),
		Event:           wireEvent,
	})
	if err != nil {
		return err
	}
	return stream.Send(ctx, protocol.Event{
		Type:            protocol.EventHerdrCore,
		ProtocolVersion: protocol.Version,
		RunnerID:        d.computerID,
		Payload:         payload,
	})
}

func toWireHerdrCoreEvent(event herdrcore.Event) (wire.HerdrCoreEvent, bool) {
	switch event.Kind {
	case herdrcore.EventBlocked, herdrcore.EventFinished, herdrcore.EventError, herdrcore.EventTerminalChanged:
	default:
		return wire.HerdrCoreEvent{}, false
	}
	address := clipRunes(strings.TrimSpace(event.Address), 256)
	if address == "" {
		return wire.HerdrCoreEvent{}, false
	}
	var statusMS uint64
	if event.StatusMS != nil {
		statusMS = *event.StatusMS
	}
	tail := event.Tail
	if tail != "" {
		tail = clipRunes(herdrcore.Redact(tail), 8000)
	}
	return wire.HerdrCoreEvent{
		Kind:     event.Kind,
		Address:  address,
		Machine:  clipRunes(machineFromAddress(address), 128),
		Turn:     event.Turn,
		StatusMs: statusMS,
		Status:   toWireHerdrCoreStatus(event.Status),
		Name:     clipRunes(event.Name, 256),
		Cwd:      clipRunes(event.Cwd, 4096),
		Title:    clipRunes(event.Title, 500),
		Template: clipRunes(event.Template, 120),
		Parent:   clipRunes(event.Parent, 256),
		Labels:   encodeWireHerdrCoreLabels(event.Labels),
		Tail:     tail,
	}, true
}

func toWireHerdrCoreStatus(status *herdrcore.Status) *wire.HerdrCoreTerminalStatus {
	if status == nil {
		return nil
	}
	switch status.State {
	case herdrcore.StatusIdle, herdrcore.StatusWorking, herdrcore.StatusDone, herdrcore.StatusBlocked, herdrcore.StatusError:
	default:
		return nil
	}
	out := &wire.HerdrCoreTerminalStatus{
		State: status.State,
		App:   clipRunes(status.App, 120),
		Msg:   clipRunes(status.Msg, 2000),
		Title: clipRunes(status.Title, 500),
	}
	if status.Progress != nil {
		v := float64(*status.Progress)
		if v > 100 {
			v = 100
		}
		out.Progress = &v
	}
	return out
}

func encodeWireHerdrCoreLabels(labels map[string]string) json.RawMessage {
	if len(labels) == 0 {
		return nil
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		if k != "" {
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	slices.Sort(keys)
	if len(keys) > herdrCoreMaxLabels {
		keys = keys[:herdrCoreMaxLabels]
	}
	bounded := make(map[string]string, len(keys))
	for _, k := range keys {
		bounded[k] = clipRunes(labels[k], 256)
	}
	encoded, err := json.Marshal(bounded)
	if err != nil {
		return nil
	}
	return encoded
}

// callHerdrCore dispatches one control-plane or attach tool call for
// server="herdr_core". Control calls require service_features["herdr_core_v1"];
// attach calls require service_features["herdr_core_stream"] and owner scope.
func (d *Daemon) callHerdrCore(connectionCtx, callCtx context.Context, connectionEpoch uint64, agentID, name string, arguments json.RawMessage) (map[string]any, error) {
	if name == "attach" {
		if agentID != ownerHerdrCoreAgentID {
			return map[string]any{"status": "forbidden", "detail": "Only the Computer's owner can open a herdr-core attach stream"}, nil
		}
		if !d.herdrCoreStream.Load() {
			return map[string]any{"status": "unavailable", "detail": "herdr_core_stream is not enabled on this Runner Gateway connection"}, nil
		}
		if d.herdrCore == nil {
			return map[string]any{"status": herdrcore.AnswerUnavailable, "detail": "herdr-core is not installed on this Computer"}, nil
		}
		return d.attachHerdrCoreStream(connectionCtx, callCtx, connectionEpoch, arguments), nil
	}
	if !d.herdrCoreV1.Load() {
		return map[string]any{"status": "unavailable", "detail": "herdr_core_v1 is not enabled on this Runner Gateway connection"}, nil
	}
	if d.herdrCore == nil {
		return map[string]any{"status": herdrcore.AnswerUnavailable, "detail": "herdr-core is not installed on this Computer"}, nil
	}
	switch name {
	case "status":
		return d.herdrCoreStatus(callCtx), nil
	case "list":
		return d.herdrCoreList(callCtx, arguments), nil
	case "get":
		return d.herdrCoreGet(callCtx, arguments), nil
	case "read":
		return d.herdrCoreRead(callCtx, arguments), nil
	case "run":
		return d.herdrCoreRun(callCtx, arguments), nil
	case "send":
		return d.herdrCoreSend(callCtx, arguments), nil
	case "keys":
		return d.herdrCoreKeys(callCtx, arguments), nil
	case "interrupt":
		return d.herdrCoreInterrupt(callCtx, arguments), nil
	case "wait":
		return d.herdrCoreWait(callCtx, arguments), nil
	case "kill":
		return d.herdrCoreKill(callCtx, arguments), nil
	case "rm":
		return d.herdrCoreRemove(callCtx, arguments), nil
	case "keep":
		return d.herdrCoreKeep(callCtx, arguments), nil
	case "label":
		return d.herdrCoreLabel(callCtx, arguments), nil
	case "put":
		return d.herdrCorePut(callCtx, arguments), nil
	case "templates":
		return d.herdrCoreTemplates(callCtx), nil
	case "machines":
		return d.herdrCoreMachines(callCtx), nil
	case "exec":
		return d.herdrCoreExec(callCtx, arguments), nil
	case "file_read":
		return d.herdrCoreFileRead(callCtx, arguments), nil
	case "file_write":
		return d.herdrCoreFileWrite(callCtx, arguments), nil
	case "file_edit":
		return d.herdrCoreFileEdit(callCtx, arguments), nil
	case "doc_get":
		return d.herdrCoreDocGet(callCtx, arguments), nil
	case "doc_set":
		return d.herdrCoreDocSet(callCtx, arguments), nil
	case "answer":
		return d.herdrCoreAnswer(callCtx, arguments)
	default:
		return map[string]any{"status": "invalid_request", "detail": "Unsupported herdr_core tool: " + name}, nil
	}
}

func (d *Daemon) herdrCoreStatus(ctx context.Context) map[string]any {
	status, err := d.herdrCore.ServerStatus(ctx)
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	blockedCount := 0
	workingCount := 0
	machines := []map[string]any{}
	if listed, listErr := d.herdrCore.TerminalList(ctx, herdrcore.TerminalListParams{All: false}); listErr == nil {
		liveByMachine := map[string]int{}
		for _, t := range listed.Terminals {
			if t.State == herdrcore.TerminalStateLive {
				liveByMachine[machineFromAddress(t.Address)]++
			}
			if t.Status != nil {
				switch t.Status.State {
				case herdrcore.StatusBlocked:
					blockedCount++
				case herdrcore.StatusWorking:
					workingCount++
				}
			}
		}
		machines = serializeHerdrCoreMachines(listed.Machines, liveByMachine)
	}
	return map[string]any{
		"available":      true,
		"version":        status.Version,
		"core_id":        status.Core.ID,
		"core_name":      status.Core.Name,
		"pid":            status.PID,
		"uptime_ms":      status.UptimeMS,
		"live_count":     status.Live,
		"finished_count": status.Finished,
		"blocked_count":  blockedCount,
		"working_count":  workingCount,
		"machines":       machines,
	}
}

func (d *Daemon) herdrCoreList(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		All        bool              `json:"all"`
		Machine    string            `json:"machine"`
		RoomID     string            `json:"room_id"`
		WorkItemID string            `json:"work_item_id"`
		Status     string            `json:"status"`
		Labels     map[string]string `json:"labels"`
	}
	if len(arguments) > 0 && !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid list arguments"}
	}
	labels := map[string]string{}
	for k, v := range req.Labels {
		if k != "" && v != "" {
			labels[k] = v
		}
	}
	if room := strings.TrimSpace(req.RoomID); room != "" {
		labels["linger.room"] = room
	}
	if wi := strings.TrimSpace(req.WorkItemID); wi != "" {
		labels["linger.work_item"] = wi
	}
	var labelFilter map[string]string
	if len(labels) > 0 {
		labelFilter = labels
	}
	listed, err := d.herdrCore.TerminalList(ctx, herdrcore.TerminalListParams{
		All:    req.All,
		Labels: labelFilter,
	})
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	machineFilter := strings.TrimSpace(req.Machine)
	statusFilter := strings.TrimSpace(req.Status)
	liveByMachine := map[string]int{}
	terminals := make([]map[string]any, 0, len(listed.Terminals))
	for _, t := range listed.Terminals {
		machine := machineFromAddress(t.Address)
		if t.State == herdrcore.TerminalStateLive {
			liveByMachine[machine]++
		}
		if machineFilter != "" {
			if strings.EqualFold(machineFilter, "local") {
				if machine != "" && !strings.EqualFold(machine, "local") {
					continue
				}
			} else if machine != machineFilter {
				continue
			}
		}
		if statusFilter != "" {
			statusState := ""
			if t.Status != nil {
				statusState = t.Status.State
			}
			if !strings.EqualFold(statusState, statusFilter) && !strings.EqualFold(t.State, statusFilter) {
				continue
			}
		}
		terminals = append(terminals, serializeHerdrCoreTerminal(t))
	}
	return map[string]any{
		"terminals": terminals,
		"machines":  serializeHerdrCoreMachines(listed.Machines, liveByMachine),
	}
}

func (d *Daemon) herdrCoreGet(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string `json:"address"`
		Terminal string `json:"terminal"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid get arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "address is required"}
	}
	term, err := d.herdrCore.TerminalGet(ctx, herdrcore.TerminalGetParams{Terminal: address})
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	return map[string]any{"terminal": serializeHerdrCoreTerminal(term)}
}

func (d *Daemon) herdrCoreRead(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string `json:"address"`
		Terminal string `json:"terminal"`
		Lines    uint   `json:"lines"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid read arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "address is required"}
	}
	if req.Lines > herdrCoreMaxReadLines {
		return map[string]any{"status": "invalid_arguments", "detail": "lines must be at most 5000"}
	}
	res, err := d.herdrCore.TerminalRead(ctx, herdrcore.TerminalReadParams{
		Terminal: address,
		Lines:    req.Lines,
	})
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	return map[string]any{
		"text":     res.Text,
		"complete": res.Complete,
		"how":      res.How,
		"why":      derefString(res.Why),
	}
}

func (d *Daemon) herdrCoreRun(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Argv          []string          `json:"argv"`
		Line          string            `json:"line"`
		Template      string            `json:"template"`
		Task          string            `json:"task"`
		Name          string            `json:"name"`
		Cwd           string            `json:"cwd"`
		On            string            `json:"on"`
		Keep          bool              `json:"keep"`
		Labels        map[string]string `json:"labels"`
		Parent        string            `json:"parent"`
		RM            bool              `json:"rm"`
		NoNotify      bool              `json:"no_notify"`
		NoParent      bool              `json:"no_parent"`
		OutliveParent bool              `json:"outlive_parent"`
		Env           map[string]string `json:"env"`
		Wait          bool              `json:"wait"`
		Timeout       *float64          `json:"timeout"`
		Size          json.RawMessage   `json:"size"`
	}
	if len(arguments) > 0 && !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid run arguments"}
	}
	template := strings.TrimSpace(req.Template)
	line := req.Line
	argv := req.Argv
	if template != "" {
		if len(argv) > 0 || line != "" {
			return map[string]any{"status": "invalid_arguments", "detail": "template cannot be combined with argv or line"}
		}
		argv = []string{template}
		if req.Task != "" {
			argv = append(argv, req.Task)
		}
	} else {
		if len(argv) > 0 && line != "" {
			return map[string]any{"status": "invalid_arguments", "detail": "Provide only one of argv or line"}
		}
		if req.Task != "" && len(argv) > 0 {
			argv = append(slices.Clone(argv), req.Task)
		}
	}
	size, err := parseHerdrCoreInitialSize(req.Size)
	if err != nil {
		return map[string]any{"status": "invalid_arguments", "detail": err.Error()}
	}
	params := herdrcore.TerminalRunParams{
		Argv:          argv,
		Keep:          req.Keep,
		Labels:        req.Labels,
		NoNotify:      req.NoNotify,
		NoParent:      req.NoParent,
		OutliveParent: req.OutliveParent,
		RM:            req.RM,
		Env:           req.Env,
		Size:          size,
		Wait:          req.Wait,
		Timeout:       normalizeHerdrCoreTimeoutSeconds(req.Timeout),
	}
	if line != "" {
		params.Line = &line
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		params.Name = &name
	}
	if cwd := strings.TrimSpace(req.Cwd); cwd != "" {
		params.Cwd = &cwd
	}
	if on := strings.TrimSpace(req.On); on != "" {
		params.On = &on
	}
	if parent := strings.TrimSpace(req.Parent); parent != "" {
		params.Parent = &parent
	}
	res, err := d.herdrCore.TerminalRun(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	out := map[string]any{"terminal": serializeHerdrCoreTerminal(res.Terminal)}
	if res.Output != nil {
		out["output"] = *res.Output
	}
	if res.Wait != nil {
		out["wait"] = res.Wait
	}
	return out
}

func (d *Daemon) herdrCoreSend(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string   `json:"address"`
		Terminal string   `json:"terminal"`
		Text     string   `json:"text"`
		If       string   `json:"if"`
		Turn     *uint64  `json:"turn"`
		Force    bool     `json:"force"`
		Wait     bool     `json:"wait"`
		Timeout  *float64 `json:"timeout"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid send arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "address is required"}
	}
	params := herdrcore.TerminalSendParams{
		Terminal: address,
		Text:     req.Text,
		Force:    req.Force,
		Wait:     req.Wait,
		Timeout:  normalizeHerdrCoreTimeoutSeconds(req.Timeout),
	}
	switch strings.TrimSpace(req.If) {
	case "":
	case string(herdrcore.SendIfIdle):
		cond := herdrcore.SendIfIdle
		params.If = &cond
	case string(herdrcore.SendIfWorking):
		cond := herdrcore.SendIfWorking
		params.If = &cond
	case herdrcore.StatusBlocked:
		// herdr-core v0.1.21 rejects if="blocked" with invalid_params.
		// Perform terminal.get CAS (live + blocked + optional turn) first, then
		// dispatch terminal.send with force=true and no "if" field.
		term, err := d.herdrCore.TerminalGet(ctx, herdrcore.TerminalGetParams{Terminal: address})
		if err != nil {
			return herdrCoreBlockedCASReadError(err)
		}
		if term.State != herdrcore.TerminalStateLive {
			return map[string]any{"status": herdrcore.AnswerTerminalClosed, "detail": "Terminal is no longer live"}
		}
		if term.Status == nil || term.Status.State != herdrcore.StatusBlocked {
			return map[string]any{"status": herdrcore.AnswerTerminalNotBlocked, "detail": "Terminal is not blocked"}
		}
		if req.Turn != nil && term.Turn != *req.Turn {
			return map[string]any{"status": herdrcore.AnswerTerminalNotBlocked, "detail": "Terminal turn has moved on"}
		}
		params.Force = true
		params.If = nil
	default:
		return map[string]any{"status": "invalid_arguments", "detail": "if must be one of idle, working, or blocked"}
	}
	res, err := d.herdrCore.TerminalSend(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	out := map[string]any{
		"status":  sendOrKeysStatus(res.Status),
		"turn":    res.Turn,
		"started": res.Started != nil && *res.Started,
	}
	if res.Wait != nil {
		out["wait"] = res.Wait
	}
	return out
}

func (d *Daemon) herdrCoreKeys(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string   `json:"address"`
		Terminal string   `json:"terminal"`
		Keys     []string `json:"keys"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid keys arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" || len(req.Keys) == 0 || len(req.Keys) > herdrCoreMaxKeys {
		return map[string]any{"status": "invalid_arguments", "detail": "address and 1 to 128 keys are required"}
	}
	cleaned := make([]string, len(req.Keys))
	for i, key := range req.Keys {
		if strings.ContainsFunc(key, unicode.IsControl) {
			return map[string]any{"status": "invalid_arguments", "detail": "keys must not contain control characters"}
		}
		trimmed := strings.TrimSpace(key)
		if trimmed == "" || utf8.RuneCountInString(trimmed) > 64 {
			return map[string]any{"status": "invalid_arguments", "detail": "each key must be 1 to 64 characters"}
		}
		cleaned[i] = trimmed
	}
	res, err := d.herdrCore.TerminalKeys(ctx, herdrcore.TerminalKeysParams{
		Terminal: address,
		Keys:     cleaned,
	})
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{
		"status": sendOrKeysStatus(res.Status),
		"turn":   res.Turn,
	}
}

func (d *Daemon) herdrCoreInterrupt(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string   `json:"address"`
		Terminal string   `json:"terminal"`
		Timeout  *float64 `json:"timeout"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid interrupt arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "address is required"}
	}
	res, err := d.herdrCore.TerminalInterrupt(ctx, herdrcore.TerminalInterruptParams{
		Terminal: address,
		Timeout:  normalizeHerdrCoreTimeoutSeconds(req.Timeout),
	})
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{
		"key":     res.Key,
		"outcome": res.Outcome,
	}
}

func (d *Daemon) herdrCoreWait(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string   `json:"address"`
		Terminal string   `json:"terminal"`
		Children string   `json:"children"`
		Output   *string  `json:"output"`
		Timeout  *float64 `json:"timeout"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid wait arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	params := herdrcore.TerminalWaitParams{
		Output:  req.Output,
		Timeout: normalizeHerdrCoreTimeoutSeconds(req.Timeout),
	}
	if address != "" {
		params.Terminal = &address
	}
	switch strings.TrimSpace(req.Children) {
	case "":
	case string(herdrcore.WaitChildrenAny):
		mode := herdrcore.WaitChildrenAny
		params.Children = &mode
	case string(herdrcore.WaitChildrenAll):
		mode := herdrcore.WaitChildrenAll
		params.Children = &mode
	default:
		return map[string]any{"status": "invalid_arguments", "detail": "children must be any or all"}
	}
	if params.Terminal == nil && params.Children == nil {
		return map[string]any{"status": "invalid_arguments", "detail": "address or children is required"}
	}
	res, err := d.herdrCore.TerminalWait(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	children := res.Children
	if children == nil {
		children = []herdrcore.WaitResult{}
	}
	out := map[string]any{
		"terminal": res.Terminal,
		"ended":    res.Ended,
		"reason":   res.Reason,
		"turn":     res.Turn,
		"children": children,
	}
	if res.Status != nil {
		out["status"] = *res.Status
	}
	if res.ExitCode != nil {
		out["exit_code"] = *res.ExitCode
	}
	if res.Signal != nil {
		out["signal"] = *res.Signal
	}
	if res.From != nil {
		out["from"] = *res.From
	}
	return out
}

func (d *Daemon) herdrCoreKill(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string `json:"address"`
		Terminal string `json:"terminal"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid kill arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "address is required"}
	}
	if _, err := d.herdrCore.TerminalKill(ctx, herdrcore.TerminalKillParams{Terminal: address}); err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{"ok": true}
}

func (d *Daemon) herdrCoreRemove(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string `json:"address"`
		Terminal string `json:"terminal"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid rm arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "address is required"}
	}
	if _, err := d.herdrCore.TerminalRemove(ctx, herdrcore.TerminalRemoveParams{Terminal: address}); err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{"removed": true}
}

func (d *Daemon) herdrCoreKeep(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string `json:"address"`
		Terminal string `json:"terminal"`
		Keep     *bool  `json:"keep"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid keep arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" || req.Keep == nil {
		return map[string]any{"status": "invalid_arguments", "detail": "address and boolean keep are required"}
	}
	term, err := d.herdrCore.TerminalKeep(ctx, herdrcore.TerminalKeepParams{
		Terminal: address,
		Keep:     *req.Keep,
	})
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{"terminal": serializeHerdrCoreTerminal(term)}
}

func (d *Daemon) herdrCoreLabel(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address  string            `json:"address"`
		Terminal string            `json:"terminal"`
		Labels   map[string]string `json:"labels"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid label arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	if address == "" || len(req.Labels) == 0 {
		return map[string]any{"status": "invalid_arguments", "detail": "address and labels are required"}
	}
	for k := range req.Labels {
		if strings.TrimSpace(k) == "" {
			return map[string]any{"status": "invalid_arguments", "detail": "label keys must not be empty"}
		}
	}
	term, err := d.herdrCore.TerminalLabel(ctx, herdrcore.TerminalLabelParams{
		Terminal: address,
		Labels:   req.Labels,
	})
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{"terminal": serializeHerdrCoreTerminal(term)}
}

func (d *Daemon) herdrCorePut(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Address    string `json:"address"`
		Terminal   string `json:"terminal"`
		Name       string `json:"name"`
		DataBase64 string `json:"data_base64"`
		Data       string `json:"data"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid put arguments"}
	}
	address := firstAddress(req.Address, req.Terminal)
	name := strings.TrimSpace(req.Name)
	encoded := req.DataBase64
	if encoded == "" {
		encoded = req.Data
	}
	if address == "" || name == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "address and name are required"}
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return map[string]any{"status": "invalid_arguments", "detail": "data_base64 must be valid base64"}
	}
	if len(raw) > herdrCoreMaxPutBytes {
		return map[string]any{"status": "invalid_arguments", "detail": "upload exceeds 8 MiB limit"}
	}
	res, err := d.herdrCore.TerminalPut(ctx, herdrcore.TerminalPutParams{
		Terminal: address,
		Name:     name,
		Data:     encoded,
	})
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{
		"path":  res.Path,
		"bytes": res.Bytes,
	}
}

func (d *Daemon) herdrCoreTemplates(ctx context.Context) map[string]any {
	res, err := d.herdrCore.TemplatesList(ctx)
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	templates := make([]map[string]any, 0, len(res.Templates))
	for _, tpl := range res.Templates {
		item := map[string]any{
			"name":        tpl.Name,
			"description": tpl.Description,
			"command":     tpl.Command,
			"line":        tpl.Command,
		}
		if tpl.Error != nil && *tpl.Error != "" {
			item["error"] = *tpl.Error
		}
		templates = append(templates, item)
	}
	return map[string]any{"templates": templates}
}

func (d *Daemon) herdrCoreMachines(ctx context.Context) map[string]any {
	res, err := d.herdrCore.MachineList(ctx)
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	return map[string]any{"machines": serializeHerdrCoreMachines(res.Machines, nil)}
}

func (d *Daemon) herdrCoreExec(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Argv        []string          `json:"argv"`
		Line        string            `json:"line"`
		Cwd         string            `json:"cwd"`
		On          string            `json:"on"`
		Env         map[string]string `json:"env"`
		Input       *string           `json:"input"`
		InputBase64 *string           `json:"input_base64"`
		Timeout     *float64          `json:"timeout"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid exec arguments"}
	}
	hasArgv := len(req.Argv) > 0
	hasLine := strings.TrimSpace(req.Line) != ""
	if hasArgv == hasLine {
		return map[string]any{"status": "invalid_arguments", "detail": "Provide exactly one of argv or line"}
	}
	params := herdrcore.MachineExecParams{
		Argv:    req.Argv,
		Env:     req.Env,
		Timeout: normalizeHerdrCoreTimeoutSeconds(req.Timeout),
	}
	if hasLine {
		line := req.Line
		params.Line = &line
	}
	if cwd := strings.TrimSpace(req.Cwd); cwd != "" {
		params.Cwd = &cwd
	}
	if on := strings.TrimSpace(req.On); on != "" {
		params.On = &on
	}
	if req.InputBase64 != nil {
		params.Input = req.InputBase64
	} else if req.Input != nil {
		params.Input = req.Input
	}
	res, err := d.herdrCore.MachineExec(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{
		"code":          res.Code,
		"signal":        res.Signal,
		"ms":            res.MS,
		"timed_out":     res.TimedOut,
		"truncated":     res.Truncated,
		"stdout":        decodeBase64OrRaw(res.Stdout),
		"stderr":        decodeBase64OrRaw(res.Stderr),
		"stdout_base64": res.Stdout,
		"stderr_base64": res.Stderr,
	}
}

func (d *Daemon) herdrCoreFileRead(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Path   string `json:"path"`
		Cwd    string `json:"cwd"`
		On     string `json:"on"`
		Offset *uint  `json:"offset"`
		Limit  *uint  `json:"limit"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid file_read arguments"}
	}
	path := strings.TrimSpace(req.Path)
	if path == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "path is required"}
	}
	params := herdrcore.FileReadParams{
		Path:  path,
		Limit: req.Limit,
	}
	// herdr-core file.read offsets are 1-based; treat offset=0 as omitted so
	// 0-based callers read from the beginning cleanly.
	if req.Offset != nil && *req.Offset > 0 {
		offset := *req.Offset
		params.Offset = &offset
	}
	if cwd := strings.TrimSpace(req.Cwd); cwd != "" {
		params.Cwd = &cwd
	}
	if on := strings.TrimSpace(req.On); on != "" {
		params.On = &on
	}
	res, err := d.herdrCore.FileRead(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	return map[string]any{
		"text":  res.Text,
		"first": res.First,
		"last":  res.Last,
		"lines": res.Lines,
	}
}

func (d *Daemon) herdrCoreFileWrite(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Path       string  `json:"path"`
		Cwd        string  `json:"cwd"`
		On         string  `json:"on"`
		Content    *string `json:"content"`
		DataBase64 *string `json:"data_base64"`
		Data       *string `json:"data"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid file_write arguments"}
	}
	path := strings.TrimSpace(req.Path)
	if path == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "path is required"}
	}
	var encoded string
	switch {
	case req.DataBase64 != nil:
		raw, err := base64.StdEncoding.DecodeString(*req.DataBase64)
		if err != nil {
			return map[string]any{"status": "invalid_arguments", "detail": "data_base64 must be valid base64"}
		}
		if len(raw) > herdrCoreMaxPutBytes {
			return map[string]any{"status": "invalid_arguments", "detail": "file exceeds 8 MiB limit"}
		}
		encoded = *req.DataBase64
	case req.Data != nil:
		raw, err := base64.StdEncoding.DecodeString(*req.Data)
		if err != nil {
			return map[string]any{"status": "invalid_arguments", "detail": "data must be valid base64"}
		}
		if len(raw) > herdrCoreMaxPutBytes {
			return map[string]any{"status": "invalid_arguments", "detail": "file exceeds 8 MiB limit"}
		}
		encoded = *req.Data
	case req.Content != nil:
		if len(*req.Content) > herdrCoreMaxPutBytes {
			return map[string]any{"status": "invalid_arguments", "detail": "content exceeds 8 MiB limit"}
		}
		encoded = base64.StdEncoding.EncodeToString([]byte(*req.Content))
	default:
		return map[string]any{"status": "invalid_arguments", "detail": "content or data_base64 is required"}
	}
	params := herdrcore.FileWriteParams{
		Path: path,
		Data: encoded,
	}
	if cwd := strings.TrimSpace(req.Cwd); cwd != "" {
		params.Cwd = &cwd
	}
	if on := strings.TrimSpace(req.On); on != "" {
		params.On = &on
	}
	res, err := d.herdrCore.FileWrite(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{
		"path":  res.Path,
		"bytes": res.Bytes,
	}
}

func (d *Daemon) herdrCoreFileEdit(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Path       string           `json:"path"`
		Cwd        string           `json:"cwd"`
		On         string           `json:"on"`
		Edits      []herdrcore.Edit `json:"edits"`
		Old        *string          `json:"old"`
		New        *string          `json:"new"`
		ReplaceAll bool             `json:"replace_all"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid file_edit arguments"}
	}
	path := strings.TrimSpace(req.Path)
	if path == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "path is required"}
	}
	var cwdPtr, onPtr *string
	if cwd := strings.TrimSpace(req.Cwd); cwd != "" {
		cwdPtr = &cwd
	}
	if on := strings.TrimSpace(req.On); on != "" {
		onPtr = &on
	}
	if len(req.Edits) == 0 && req.ReplaceAll && req.Old != nil && *req.Old != "" && req.New != nil {
		readRes, err := d.herdrCore.FileRead(ctx, herdrcore.FileReadParams{
			Path: path,
			Cwd:  cwdPtr,
			On:   onPtr,
		})
		if err != nil {
			return herdrCoreErrorResult(err, false)
		}
		if !strings.Contains(readRes.Text, *req.Old) {
			return map[string]any{"status": "conflict", "detail": "old text was not found in file"}
		}
		updated := strings.ReplaceAll(readRes.Text, *req.Old, *req.New)
		if len(updated) > herdrCoreMaxPutBytes {
			return map[string]any{"status": "invalid_arguments", "detail": "edited file exceeds 8 MiB limit"}
		}
		res, err := d.herdrCore.FileWrite(ctx, herdrcore.FileWriteParams{
			Path: path,
			Cwd:  cwdPtr,
			On:   onPtr,
			Data: base64.StdEncoding.EncodeToString([]byte(updated)),
		})
		if err != nil {
			return herdrCoreErrorResult(err, true)
		}
		return map[string]any{"path": res.Path, "bytes": res.Bytes}
	}
	edits := req.Edits
	if len(edits) == 0 {
		if req.Old == nil || *req.Old == "" || req.New == nil {
			return map[string]any{"status": "invalid_arguments", "detail": "edits or non-empty old and new are required"}
		}
		edits = []herdrcore.Edit{{Old: *req.Old, New: *req.New}}
	}
	res, err := d.herdrCore.FileEdit(ctx, herdrcore.FileEditParams{
		Path:  path,
		Cwd:   cwdPtr,
		On:    onPtr,
		Edits: edits,
	})
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{
		"path":  res.Path,
		"bytes": res.Bytes,
	}
}

func (d *Daemon) herdrCoreDocGet(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Name string `json:"name"`
		On   string `json:"on"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid doc_get arguments"}
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "name is required"}
	}
	params := herdrcore.DocGetParams{Name: name}
	if on := strings.TrimSpace(req.On); on != "" {
		params.On = &on
	}
	res, err := d.herdrCore.DocGet(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}
	var value any
	if len(res.Value) > 0 {
		value = res.Value
	}
	return map[string]any{
		"version": res.Version,
		"value":   value,
	}
}

func (d *Daemon) herdrCoreDocSet(ctx context.Context, arguments json.RawMessage) map[string]any {
	var req struct {
		Name    string          `json:"name"`
		On      string          `json:"on"`
		Version uint64          `json:"version"`
		Value   json.RawMessage `json:"value"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid doc_set arguments"}
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "name is required"}
	}
	value := req.Value
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	params := herdrcore.DocSetParams{
		Name:    name,
		Version: req.Version,
		Value:   value,
	}
	if on := strings.TrimSpace(req.On); on != "" {
		params.On = &on
	}
	res, err := d.herdrCore.DocSet(ctx, params)
	if err != nil {
		return herdrCoreErrorResult(err, true)
	}
	return map[string]any{"version": res.Version}
}

// herdrCoreAnswer delivers an owner's question-card answer (either text via
// AnswerText or key sequence via AnswerKeys) bound to (address, turn) with
// strict at-most-once semantics. A post-check transport error propagates so
// handleComputerTool reports outcome_unknown and TeamHub never retries.
func (d *Daemon) herdrCoreAnswer(ctx context.Context, arguments json.RawMessage) (map[string]any, error) {
	var req struct {
		Address  string   `json:"address"`
		Terminal string   `json:"terminal"`
		Turn     uint64   `json:"turn"`
		StatusMS uint64   `json:"status_ms"`
		Text     string   `json:"text"`
		Keys     []string `json:"keys"`
	}
	if !decodes(arguments, &req) {
		return map[string]any{"status": herdrcore.AnswerInvalid}, nil
	}
	address := firstAddress(req.Address, req.Terminal)
	hasKeys := len(req.Keys) > 0
	hasText := req.Text != ""
	if address == "" || hasKeys == hasText {
		return map[string]any{"status": herdrcore.AnswerInvalid}, nil
	}
	var (
		status string
		err    error
	)
	if hasKeys {
		status, err = d.herdrCore.AnswerKeys(ctx, address, req.Turn, req.Keys)
	} else {
		status, err = d.herdrCore.AnswerText(ctx, address, req.Turn, req.Text)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": status}, nil
}

func serializeHerdrCoreTerminal(t herdrcore.Terminal) map[string]any {
	labels := map[string]string{}
	for k, v := range t.Labels {
		labels[k] = v
	}
	fgCwd := ""
	if t.Foreground != nil {
		fgCwd = t.Foreground.Cwd
	}
	var statusMS uint64
	if t.StatusMS != nil {
		statusMS = *t.StatusMS
	}
	return map[string]any{
		"address":        t.Address,
		"machine":        machineFromAddress(t.Address),
		"name":           derefString(t.Name),
		"state":          t.State,
		"status":         serializeHerdrCoreStatus(t.Status),
		"turn":           t.Turn,
		"status_ms":      statusMS,
		"cwd":            t.Cwd,
		"foreground_cwd": fgCwd,
		"title":          t.Title,
		"template":       derefString(t.Template),
		"parent":         derefString(t.Parent),
		"keep":           t.Keep,
		"labels":         labels,
		"cols":           t.Cols,
		"rows":           t.Rows,
		"created_ms":     t.CreatedMS,
		"finished_ms":    t.FinishedMS,
		"exit_code":      t.ExitCode,
	}
}

func serializeHerdrCoreStatus(status *herdrcore.Status) any {
	if status == nil {
		return nil
	}
	out := map[string]any{"state": status.State}
	if status.App != "" {
		out["app"] = status.App
	}
	if status.Kind != nil && *status.Kind != "" {
		out["kind"] = *status.Kind
	}
	if status.Msg != "" {
		out["msg"] = status.Msg
	}
	if status.Progress != nil {
		v := float64(*status.Progress)
		if v > 100 {
			v = 100
		}
		out["progress"] = v
	}
	if status.Title != "" {
		out["title"] = status.Title
	}
	return out
}

func serializeHerdrCoreMachines(machines []herdrcore.MachineView, liveByMachine map[string]int) []map[string]any {
	out := make([]map[string]any, 0, len(machines))
	for _, m := range machines {
		online := strings.EqualFold(m.State, "connected") ||
			strings.EqualFold(m.State, "ready") ||
			strings.EqualFold(m.State, "online")
		item := map[string]any{
			"name":       m.Name,
			"host":       m.Host,
			"status":     m.State,
			"state":      m.State,
			"online":     online,
			"version":    m.Version,
			"live_count": liveByMachine[m.Name],
		}
		if m.ID != "" {
			item["id"] = m.ID
		}
		if m.Target != "" {
			item["target"] = m.Target
		}
		if m.Via {
			item["via"] = true
		}
		if m.Temporary {
			item["temporary"] = true
		}
		if m.Why != nil && *m.Why != "" {
			item["error"] = *m.Why
		}
		out = append(out, item)
	}
	return out
}

func herdrCoreBlockedCASReadError(err error) map[string]any {
	switch herdrcore.ErrorKind(err) {
	case herdrcore.ErrKindNotFound, herdrcore.ErrKindMachineUnknown, herdrcore.ErrKindFinished:
		return map[string]any{"status": herdrcore.AnswerTerminalClosed, "detail": err.Error()}
	default:
		var hcErr *herdrcore.Error
		if errors.As(err, &hcErr) {
			return map[string]any{"status": herdrcore.AnswerTerminalClosed, "detail": err.Error()}
		}
		return map[string]any{"status": herdrcore.AnswerUnavailable, "detail": err.Error()}
	}
}

func herdrCoreErrorResult(err error, mutating bool) map[string]any {
	var hcErr *herdrcore.Error
	if errors.As(err, &hcErr) {
		detail := hcErr.Message
		if detail == "" {
			detail = hcErr.Error()
		}
		switch hcErr.Kind {
		case herdrcore.ErrKindNotFound, herdrcore.ErrKindMachineUnknown:
			return map[string]any{"status": "not_found", "detail": detail}
		case herdrcore.ErrKindFinished:
			return map[string]any{"status": herdrcore.AnswerTerminalClosed, "detail": detail}
		case herdrcore.ErrKindBlocked, herdrcore.ErrKindStatusMismatch:
			return map[string]any{"status": herdrcore.AnswerTerminalNotBlocked, "detail": detail}
		case herdrcore.ErrKindConflict:
			return map[string]any{"status": "version_conflict", "detail": detail}
		case herdrcore.ErrKindNameTaken, herdrcore.ErrKindAlreadyAdded, herdrcore.ErrKindLive, herdrcore.ErrKindEditFailed:
			return map[string]any{"status": "conflict", "detail": detail}
		case herdrcore.ErrKindInvalidParams, herdrcore.ErrKindNeedsTarget, herdrcore.ErrKindInvalidTemplate, herdrcore.ErrKindNotText:
			return map[string]any{"status": "invalid_arguments", "detail": detail}
		case herdrcore.ErrKindUnavailable, herdrcore.ErrKindUnreachable, herdrcore.ErrKindHCMissing:
			return map[string]any{"status": herdrcore.AnswerUnavailable, "detail": detail}
		default:
			return map[string]any{"status": "error", "detail": detail}
		}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return map[string]any{"status": "outcome_unknown", "detail": "herdr-core did not confirm the request before the deadline"}
	}
	if !mutating || isHerdrCoreDialFailure(err) {
		return map[string]any{"status": herdrcore.AnswerUnavailable, "detail": err.Error()}
	}
	return map[string]any{"status": "outcome_unknown", "detail": "herdr-core connection dropped before confirming the result"}
}

func isHerdrCoreDialFailure(err error) bool {
	if errors.Is(err, os.ErrNotExist) || os.IsNotExist(err) {
		return true
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "dial" {
		return true
	}
	return strings.Contains(err.Error(), "herdr-core transport is not configured")
}

func parseHerdrCoreInitialSize(raw json.RawMessage) (*herdrcore.InitialSize, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	if trimmed[0] == '"' {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return nil, errors.New("size must be COLSxROWS or {cols, rows}")
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, nil
		}
		colsPart, rowsPart, ok := strings.Cut(strings.ToLower(text), "x")
		if !ok {
			return nil, errors.New("size must use COLSxROWS format")
		}
		cols, errC := strconv.Atoi(colsPart)
		rows, errR := strconv.Atoi(rowsPart)
		if errC != nil || errR != nil || cols < 1 || cols > herdrCoreMaxCols || rows < 1 || rows > herdrCoreMaxRows {
			return nil, fmt.Errorf("size cols must be 1..%d and rows 1..%d", herdrCoreMaxCols, herdrCoreMaxRows)
		}
		return &herdrcore.InitialSize{Cols: uint16(cols), Rows: uint16(rows)}, nil
	}
	var obj struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil || obj.Cols < 1 || obj.Cols > herdrCoreMaxCols || obj.Rows < 1 || obj.Rows > herdrCoreMaxRows {
		return nil, fmt.Errorf("size cols must be 1..%d and rows 1..%d", herdrCoreMaxCols, herdrCoreMaxRows)
	}
	return &herdrcore.InitialSize{Cols: uint16(obj.Cols), Rows: uint16(obj.Rows)}, nil
}

// normalizeHerdrCoreTimeoutSeconds converts optional timeouts into seconds for
// herdr-core RPCs. Values above 600 are treated as milliseconds from TeamHub's
// REST API (0..120000 ms), while 0..600 stay in seconds for CLI callers.
func normalizeHerdrCoreTimeoutSeconds(timeout *float64) *float64 {
	if timeout == nil || math.IsNaN(*timeout) || math.IsInf(*timeout, 0) || *timeout <= 0 {
		return nil
	}
	seconds := *timeout
	if seconds > 600 {
		seconds /= 1000.0
	}
	if seconds > 600 {
		seconds = 600
	}
	return &seconds
}

func sendOrKeysStatus(status *string) string {
	if status != nil && strings.TrimSpace(*status) != "" {
		return strings.TrimSpace(*status)
	}
	return "ok"
}

func decodeBase64OrRaw(encoded string) string {
	if encoded == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return encoded
	}
	return string(raw)
}

func firstAddress(primary, fallback string) string {
	if trimmed := strings.TrimSpace(primary); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(fallback)
}

func machineFromAddress(address string) string {
	address = strings.TrimSpace(address)
	if machine, _, ok := strings.Cut(address, "/"); ok {
		return strings.TrimSpace(machine)
	}
	return ""
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func clipRunes(value string, maxRunes int) string {
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
