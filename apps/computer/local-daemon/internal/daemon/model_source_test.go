package daemon

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/localmodels"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type fakeModelSourceManager struct {
	deadline  time.Time
	lastApply localmodels.ModelSourceApply
}

func (f *fakeModelSourceManager) Status(ctx context.Context) (wire.ModelSourceStatus, error) {
	f.deadline, _ = ctx.Deadline()
	return wire.ModelSourceStatus{
		Mode:         "subscription",
		Runtime:      "claude",
		RuntimeModel: "",
		Byok:         wire.ByokSummary{Configured: false, KeySaved: false},
	}, nil
}

func (f *fakeModelSourceManager) TestByok(ctx context.Context, _ string, input wire.ByokConfigInput) (wire.ByokTestResult, error) {
	f.deadline, _ = ctx.Deadline()
	return wire.ByokTestResult{
		Ok:            true,
		Protocol:      "openai-chat",
		BaseURL:       input.BaseURL,
		ModelID:       input.ModelID,
		ContextWindow: 128000,
	}, nil
}

func (f *fakeModelSourceManager) ListByokModels(ctx context.Context, input wire.ByokConfigInput) (wire.ByokModelList, error) {
	f.deadline, _ = ctx.Deadline()
	return wire.ByokModelList{BaseURL: input.BaseURL, Models: []wire.ByokModelListModelsItem{{ID: "vendor/model"}}}, nil
}

func (f *fakeModelSourceManager) Apply(ctx context.Context, apply localmodels.ModelSourceApply) (wire.ModelSourceStatus, error) {
	f.deadline, _ = ctx.Deadline()
	f.lastApply = apply
	return wire.ModelSourceStatus{
		Mode:         apply.Mode,
		Runtime:      apply.Runtime,
		RuntimeModel: "localmodels-byok",
		GatewayURL:   "http://127.0.0.1:43120",
		Byok:         wire.ByokSummary{Configured: true, KeySaved: true, Protocol: "openai-chat", BaseURL: "https://api.example.com/v1", ModelID: "gpt-5.4"},
	}, nil
}

func TestHandleModelSourceCommandValidatesOwnerExpiryAndActions(t *testing.T) {
	manager := &fakeModelSourceManager{}
	d := &Daemon{
		computerID:      "comp-1",
		protocolVersion: protocol.Version,
		modelSource:     manager,
		owners:          []ComputerOwner{{TenantID: "tenant-1", OwnerActorID: "owner-1"}},
	}
	expires := time.Now().Add(time.Minute).UTC().Truncate(time.Millisecond)
	stream := &browserEventStream{}

	// 1. Status succeeds for the Computer's owner.
	statusCmd, _ := json.Marshal(wire.CapabilityModelSource{
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-status",
		RunnerID:        "comp-1",
		TenantID:        "tenant-1",
		OwnerActorID:    "owner-1",
		ConnectionEpoch: 1,
		ExpiresAt:       expires.Format(time.RFC3339Nano),
		Type:            wire.TypeExecute,
		Kind:            wire.KindModelSource,
		Action:          "status",
	})
	if err := d.handleModelSourceCommand(t.Context(), stream, protocol.Command{
		Type: protocol.CommandCapabilityModelSource, CommandID: "cmd-status", RunnerID: "comp-1", ConnectionEpoch: 1, Payload: statusCmd,
	}); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) != 1 || stream.events[0].Type != protocol.EventCapabilityModelSourceSucceeded {
		t.Fatalf("expected succeeded event, got %+v", stream.events)
	}
	if !manager.deadline.Equal(expires) {
		t.Fatalf("expected command deadline %v, got %v", expires, manager.deadline)
	}

	// 2. Apply succeeds and returns updated ModelSourceStatus.
	applyCmd, _ := json.Marshal(wire.CapabilityModelSource{
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-apply",
		RunnerID:        "comp-1",
		TenantID:        "tenant-1",
		OwnerActorID:    "owner-1",
		ConnectionEpoch: 1,
		ExpiresAt:       expires.Format(time.RFC3339Nano),
		Type:            wire.TypeExecute,
		Kind:            wire.KindModelSource,
		Action:          "apply",
		Mode:            "byok",
		Runtime:         "claude",
		Byok: &wire.ByokConfigInput{
			BaseURL: "https://api.example.com/v1",
			APIKey:  "sk-secret",
			ModelID: "gpt-5.4",
		},
	})
	if err := d.handleModelSourceCommand(t.Context(), stream, protocol.Command{
		Type: protocol.CommandCapabilityModelSource, CommandID: "cmd-apply", RunnerID: "comp-1", ConnectionEpoch: 1, Payload: applyCmd,
	}); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) != 2 || stream.events[1].Type != protocol.EventCapabilityModelSourceSucceeded {
		t.Fatalf("expected apply succeeded event, got %+v", stream.events)
	}
	var succeeded wire.CapabilityModelSourceSucceeded
	if err := json.Unmarshal(stream.events[1].Payload, &succeeded); err != nil {
		t.Fatal(err)
	}
	if succeeded.Status == nil || succeeded.Status.Mode != "byok" || succeeded.Status.RuntimeModel != "localmodels-byok" {
		t.Fatalf("unexpected apply status payload: %+v", succeeded.Status)
	}

	// 3. Another actor is rejected with MODEL_SOURCE_FORBIDDEN.
	intruderCmd, _ := json.Marshal(wire.CapabilityModelSource{
		ProtocolVersion: protocol.Version,
		CommandID:       "cmd-intruder",
		RunnerID:        "comp-1",
		TenantID:        "tenant-1",
		OwnerActorID:    "other-actor",
		ConnectionEpoch: 1,
		ExpiresAt:       expires.Format(time.RFC3339Nano),
		Type:            wire.TypeExecute,
		Kind:            wire.KindModelSource,
		Action:          "status",
	})
	if err := d.handleModelSourceCommand(t.Context(), stream, protocol.Command{
		Type: protocol.CommandCapabilityModelSource, CommandID: "cmd-intruder", RunnerID: "comp-1", ConnectionEpoch: 1, Payload: intruderCmd,
	}); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) != 3 || stream.events[2].Type != protocol.EventCapabilityModelSourceFailed {
		t.Fatalf("expected failed event for intruder, got %+v", stream.events)
	}
}
