package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/herdr"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/localtools"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type liveBrowserTools interface {
	CallLiveBrowser(context.Context, string, string, string, string, string, json.RawMessage) (json.RawMessage, error)
}

func (d *Daemon) handleComputerTool(ctx context.Context, stream transport.Stream, command protocol.Command) error {
	var request struct {
		ToolSessionID string          `json:"tool_session_id"`
		Server        string          `json:"server"`
		Name          string          `json:"tool_name"`
		Arguments     json.RawMessage `json:"arguments"`
		DeadlineMS    int64           `json:"deadline_ms"`
	}
	if json.Unmarshal(command.Payload, &request) != nil || request.DeadlineMS < 1000 || request.DeadlineMS > 120000 {
		return errors.New("invalid Computer tool command")
	}
	// Uses the bounded Context dispatcher. Its connection context cancels all
	// outstanding actions on disconnect and the dispatcher drains before update.
	result := map[string]any{"status": "unavailable"}
	d.admissionMu.Lock()
	draining := d.draining
	d.admissionMu.Unlock()
	d.activeMu.Lock()
	stopped := d.locallyStopped[command.AgentID]
	d.activeMu.Unlock()
	authorized := !draining && !stopped && d.ownedBy(command.TenantID, command.OwnerActorID) && command.RunnerID == d.computerID
	if authorized && d.assignments != nil {
		rows, err := d.assignments.List(ctx)
		if err != nil {
			return err
		}
		authorized = false
		for _, row := range rows {
			if row.TenantID == command.TenantID && row.AgentID == command.AgentID && row.State == "ready" {
				authorized = true
				break
			}
		}
	} else {
		authorized = false
	}
	if !authorized {
		result = map[string]any{"status": "forbidden"}
	} else {
		callCtx, cancel := context.WithTimeout(ctx, time.Duration(request.DeadlineMS)*time.Millisecond)
		defer cancel()
		var err error
		switch request.Server {
		case "browser":
			if tools, ok := d.localTools.(liveBrowserTools); ok {
				var data json.RawMessage
				data, err = tools.CallLiveBrowser(callCtx, command.TenantID, command.OwnerActorID, command.AgentID, request.ToolSessionID, request.Name, request.Arguments)
				if err == nil {
					result, err = liveBrowserResult(data)
				}
			}
		case "playground":
			result, err = d.callPlayground(callCtx, command.TenantID, command.AgentID, request.Name, request.Arguments)
		case "herdr":
			result, err = d.callHerdr(callCtx, request.Name, request.Arguments)
		}
		if failure := localtools.BrowserCallNotRun(err); failure != "" {
			// Nothing ran: the owner's Chrome is not connected or is busy.
			result = map[string]any{"status": failure}
		} else if err != nil {
			result = map[string]any{"status": "outcome_unknown", "detail": "Local tool did not confirm its result; inspect the current state before retrying."}
		}
	}
	encodedResult, err := json.Marshal(result)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(wire.ComputerToolResult{
		Type: wire.TypeExecuted, Kind: wire.KindComputerTool, ProtocolVersion: protocol.Version,
		CommandID: command.CommandID, RunnerID: command.RunnerID, ConnectionEpoch: command.ConnectionEpoch,
		TenantID: command.TenantID, OwnerActorID: command.OwnerActorID, AgentID: command.AgentID, Result: encodedResult,
	})
	if err != nil {
		return err
	}
	return stream.Send(ctx, protocol.Event{Type: protocol.EventComputerToolResult, ProtocolVersion: protocol.Version, CommandID: command.CommandID, RunnerID: command.RunnerID, Payload: payload})
}

// liveBrowserResult is a browser tool's own result, delivered as ok: it
// replaces the unavailable placeholder, and a failed browser action is the
// result's isError, not this status.
func liveBrowserResult(data json.RawMessage) (map[string]any, error) {
	result := map[string]any{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	result["status"] = "ok"
	return result, nil
}

// callHerdr answers a blocked herdr agent pane. Only TeamHub calls it, with
// the owner's answer from an answered question card bound to that pane state;
// no Agent tool reaches it.
func (d *Daemon) callHerdr(ctx context.Context, name string, arguments json.RawMessage) (map[string]any, error) {
	var request struct {
		PaneID         string `json:"pane_id"`
		StateChangeSeq uint64 `json:"state_change_seq"`
		Text           string `json:"text"`
	}
	if name != "answer" || !decodes(arguments, &request) || request.PaneID == "" {
		return map[string]any{"status": herdr.AnswerInvalid}, nil
	}
	if d.herdrPanes == nil {
		return map[string]any{"status": herdr.AnswerUnavailable}, nil
	}
	status, err := d.herdrPanes.Answer(ctx, request.PaneID, request.StateChangeSeq, request.Text)
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": status}, nil
}

// PublishHerdrEvent reports a herdr agent pane event on the live connection.
// Without one the event is dropped; the next state change is reported anew.
func (d *Daemon) PublishHerdrEvent(ctx context.Context, event herdr.Event) error {
	d.connectionMu.Lock()
	stream := d.diagnosticsStream
	d.connectionMu.Unlock()
	if stream == nil {
		return errors.New("Runner Gateway is not connected")
	}
	payload, err := json.Marshal(wire.RunnerHerdrEvent{
		Type: wire.TypeRunnerHerdrEvent, ProtocolVersion: protocol.Version, RunnerID: d.computerID,
		SentAt: d.now().UTC().Format(time.RFC3339Nano),
		Event: wire.HerdrAgentEvent{
			Kind: event.Kind, PaneID: event.PaneID, StateChangeSeq: event.StateChangeSeq, Agent: event.Agent,
			Name: event.Name, Cwd: event.Cwd, Title: event.Title, Tail: event.Tail,
		},
	})
	if err != nil {
		return err
	}
	return stream.Send(ctx, protocol.Event{Type: protocol.EventHerdrAgent, ProtocolVersion: protocol.Version, RunnerID: d.computerID, Payload: payload})
}
