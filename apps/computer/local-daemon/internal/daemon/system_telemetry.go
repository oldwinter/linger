package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

// SystemTelemetryProvider samples rootless host hardware and local LLM
// inference telemetry on this Computer.
type SystemTelemetryProvider interface {
	Sample(ctx context.Context) (wire.SystemTelemetrySnapshot, error)
}

func (d *Daemon) handleSystemTelemetryCommand(ctx context.Context, stream transport.Stream, command protocol.Command) error {
	var request wire.CapabilitySystemTelemetry
	if err := json.Unmarshal(command.Payload, &request); err != nil {
		return errors.New("invalid system telemetry command")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, request.ExpiresAt)
	if err != nil {
		return errors.New("invalid system telemetry command expiry")
	}
	sendFailed := func(code, message string, retryable bool) error {
		frame := wire.CapabilitySystemTelemetryFailed{
			ProtocolVersion: request.ProtocolVersion,
			CommandID:       request.CommandID,
			RunnerID:        request.RunnerID,
			TenantID:        request.TenantID,
			OwnerActorID:    request.OwnerActorID,
			ConnectionEpoch: request.ConnectionEpoch,
			ExpiresAt:       request.ExpiresAt,
			Type:            wire.TypeExecuted,
			Kind:            wire.KindSystemTelemetry,
			Action:          request.Action,
			Outcome:         wire.OutcomeFailed,
			Error: wire.AgentRunnerError{
				Code:      code,
				Message:   message,
				Retryable: retryable,
			},
		}
		payload, marshalErr := json.Marshal(frame)
		if marshalErr != nil {
			return marshalErr
		}
		return stream.Send(ctx, protocol.Event{
			Type:            protocol.EventCapabilitySystemTelemetryFailed,
			ProtocolVersion: command.ProtocolVersion,
			CommandID:       command.CommandID,
			RunnerID:        command.RunnerID,
			TenantID:        request.TenantID,
			OwnerActorID:    request.OwnerActorID,
			ConnectionEpoch: command.ConnectionEpoch,
			SentAt:          time.Now().UTC(),
			Payload:         payload,
		})
	}

	switch {
	case request.RunnerID != d.computerID || !d.ownedBy(request.TenantID, request.OwnerActorID):
		return sendFailed("SYSTEM_TELEMETRY_FORBIDDEN", "This Computer does not belong to the owner.", false)
	case !expiresAt.After(time.Now()):
		return sendFailed("SYSTEM_TELEMETRY_EXPIRED", "The system telemetry request expired; try again.", true)
	case request.Action != "snapshot":
		return sendFailed("SYSTEM_TELEMETRY_INVALID", "Unsupported system telemetry action.", false)
	case d.systemTelemetry == nil:
		return sendFailed("SYSTEM_TELEMETRY_UNSUPPORTED", "System telemetry is not enabled on this Computer.", false)
	}

	commandCtx, cancel := context.WithDeadline(ctx, expiresAt)
	defer cancel()

	snapshot, err := d.systemTelemetry.Sample(commandCtx)
	if err != nil {
		slog.Warn("system_telemetry.sample_failed", "error", err)
		return sendFailed("SYSTEM_TELEMETRY_FAILED", "Could not sample system telemetry on this Computer.", true)
	}

	frame := wire.CapabilitySystemTelemetrySucceeded{
		ProtocolVersion: request.ProtocolVersion,
		CommandID:       request.CommandID,
		RunnerID:        request.RunnerID,
		TenantID:        request.TenantID,
		OwnerActorID:    request.OwnerActorID,
		ConnectionEpoch: request.ConnectionEpoch,
		ExpiresAt:       request.ExpiresAt,
		Type:            wire.TypeExecuted,
		Kind:            wire.KindSystemTelemetry,
		Action:          request.Action,
		Outcome:         wire.OutcomeSucceeded,
		Telemetry:       snapshot,
	}
	payload, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	return stream.Send(ctx, protocol.Event{
		Type:            protocol.EventCapabilitySystemTelemetrySucceeded,
		ProtocolVersion: command.ProtocolVersion,
		CommandID:       command.CommandID,
		RunnerID:        command.RunnerID,
		TenantID:        request.TenantID,
		OwnerActorID:    request.OwnerActorID,
		ConnectionEpoch: command.ConnectionEpoch,
		SentAt:          time.Now().UTC(),
		Payload:         payload,
	})
}

func (d *Daemon) observeOperationTelemetry(command protocol.Command, payload json.RawMessage) {
	if d.telemetryTracker == nil || len(payload) == 0 {
		return
	}
	switch payloadType(payload) {
	case "run.started":
		clientLabel := telemetryClientLabel(command.RuntimeType)
		d.telemetryTracker.BeginRequest(command.OperationID, clientLabel, command.RuntimeType, command.RuntimeType, 0)
	case "message.delta":
		var frame struct {
			ObservedAtUnixMs int64 `json:"observed_at_unix_ms"`
		}
		observed := time.Now()
		if json.Unmarshal(payload, &frame) == nil && frame.ObservedAtUnixMs > 0 {
			observed = time.UnixMilli(frame.ObservedAtUnixMs)
		}
		d.telemetryTracker.MarkFirstToken(command.OperationID, observed)
	case "model.responded":
		var frame struct {
			Model             string `json:"model"`
			StartedAtUnixMs   int64  `json:"started_at_unix_ms"`
			FirstItemAtUnixMs int64  `json:"first_item_at_unix_ms"`
			RespondedAtUnixMs int64  `json:"responded_at_unix_ms"`
			Usage             struct {
				Input     int64 `json:"input"`
				CacheRead int64 `json:"cache_read"`
				Output    int64 `json:"output"`
			} `json:"usage"`
		}
		if json.Unmarshal(payload, &frame) != nil {
			return
		}
		modelID := strings.TrimSpace(frame.Model)
		if modelID == "" {
			modelID = command.RuntimeType
		}
		var startedAt, firstAt, completedAt time.Time
		if frame.StartedAtUnixMs > 0 {
			startedAt = time.UnixMilli(frame.StartedAtUnixMs)
		}
		if frame.FirstItemAtUnixMs > 0 {
			firstAt = time.UnixMilli(frame.FirstItemAtUnixMs)
		}
		if frame.RespondedAtUnixMs > 0 {
			completedAt = time.UnixMilli(frame.RespondedAtUnixMs)
		}
		d.telemetryTracker.RecordModelResponse(
			command.OperationID,
			telemetryClientLabel(command.RuntimeType),
			modelID,
			modelID,
			startedAt,
			firstAt,
			completedAt,
			frame.Usage.Input,
			frame.Usage.CacheRead,
			frame.Usage.Output,
			0,
			0,
		)
	}
}

func telemetryClientLabel(runtimeType string) string {
	switch strings.ToLower(strings.TrimSpace(runtimeType)) {
	case "pi":
		return "Pi Agent"
	case "claude":
		return "Claude Code"
	case "codex":
		return "Codex"
	case "antigravity":
		return "Antigravity"
	default:
		return "Local Agent"
	}
}
