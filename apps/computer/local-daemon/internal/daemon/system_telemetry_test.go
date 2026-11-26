package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type telemetryTestStream struct {
	events []protocol.Event
}

func (s *telemetryTestStream) Send(_ context.Context, event protocol.Event) error {
	s.events = append(s.events, event)
	return nil
}

func (s *telemetryTestStream) Receive(ctx context.Context) (protocol.Command, error) {
	<-ctx.Done()
	return protocol.Command{}, ctx.Err()
}

func (s *telemetryTestStream) Close() error { return nil }

var _ transport.Stream = (*telemetryTestStream)(nil)

type fakeSystemTelemetry struct {
	snapshot wire.SystemTelemetrySnapshot
	err      error
	calls    int
}

func (f *fakeSystemTelemetry) Sample(_ context.Context) (wire.SystemTelemetrySnapshot, error) {
	f.calls++
	return f.snapshot, f.err
}

func TestHandleSystemTelemetryCommand(t *testing.T) {
	provider := &fakeSystemTelemetry{
		snapshot: wire.SystemTelemetrySnapshot{
			ObservedAt: "2026-11-27T01:00:00Z",
			Hardware: wire.SystemTelemetryHardware{
				Architecture: "uma",
				Platform:     "darwin",
				Arch:         "arm64",
				Hostname:     "mac-mini",
				ChipName:     "Apple M6",
				OsLabel:      "macOS 27.2",
				Memory:       wire.SystemTelemetryMemory{TotalBytes: 24 << 30, SystemRamTotalBytes: 24 << 30},
				Bandwidth:    wire.SystemTelemetryBandwidth{Source: "unavailable"},
				Cpu:          wire.SystemTelemetryCpu{TotalCores: 12, Clusters: []wire.SystemTelemetryCpuCluster{}},
			},
			Inference: wire.SystemTelemetryInference{
				LoadedModels: []wire.SystemTelemetryLoadedModel{},
				Slots:        []wire.SystemTelemetrySlot{},
				Requests:     []wire.SystemTelemetryRequest{},
				Bottleneck:   wire.SystemTelemetryBottleneck{Kind: "idle", Severity: "info", ReasonCode: "no_active_inference"},
			},
		},
	}

	d := &Daemon{
		computerID:      "comp-1",
		owners:          []ComputerOwner{{TenantID: "tenant-1", OwnerActorID: "actor-1"}},
		systemTelemetry: provider,
	}
	stream := &telemetryTestStream{}
	expires := time.Now().UTC().Add(30 * time.Second).Format(time.RFC3339Nano)
	payload, err := json.Marshal(wire.CapabilitySystemTelemetry{
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-tel-1",
		RunnerID:        "comp-1",
		TenantID:        "tenant-1",
		OwnerActorID:    "actor-1",
		ConnectionEpoch: 1,
		ExpiresAt:       expires,
		Type:            wire.TypeExecute,
		Kind:            wire.KindSystemTelemetry,
		Action:          "snapshot",
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := d.handleSystemTelemetryCommand(context.Background(), stream, protocol.Command{
		Type:            protocol.CommandCapabilitySystemTelemetry,
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-tel-1",
		RunnerID:        "comp-1",
		ConnectionEpoch: 1,
		Payload:         payload,
	}); err != nil {
		t.Fatalf("handleSystemTelemetryCommand failed: %v", err)
	}
	if len(stream.events) != 1 || stream.events[0].Type != protocol.EventCapabilitySystemTelemetrySucceeded || provider.calls != 1 {
		t.Fatalf("unexpected events=%v calls=%d", stream.events, provider.calls)
	}

	// Non-owner must be rejected without calling sampler.
	intruderPayload, _ := json.Marshal(wire.CapabilitySystemTelemetry{
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-tel-2",
		RunnerID:        "comp-1",
		TenantID:        "tenant-1",
		OwnerActorID:    "intruder",
		ConnectionEpoch: 1,
		ExpiresAt:       expires,
		Type:            wire.TypeExecute,
		Kind:            wire.KindSystemTelemetry,
		Action:          "snapshot",
	})
	if err := d.handleSystemTelemetryCommand(context.Background(), stream, protocol.Command{
		Type:            protocol.CommandCapabilitySystemTelemetry,
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-tel-2",
		RunnerID:        "comp-1",
		ConnectionEpoch: 1,
		Payload:         intruderPayload,
	}); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) != 2 || stream.events[1].Type != protocol.EventCapabilitySystemTelemetryFailed || provider.calls != 1 {
		t.Fatalf("expected non-owner rejection, events=%v calls=%d", stream.events, provider.calls)
	}

	// Sampler error returns failed frame.
	provider.err = errors.New("probe failed")
	if err := d.handleSystemTelemetryCommand(context.Background(), stream, protocol.Command{
		Type:            protocol.CommandCapabilitySystemTelemetry,
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-tel-3",
		RunnerID:        "comp-1",
		ConnectionEpoch: 1,
		Payload:         payload,
	}); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) != 3 || stream.events[2].Type != protocol.EventCapabilitySystemTelemetryFailed {
		t.Fatalf("expected failed frame on error, got %+v", stream.events)
	}
}
