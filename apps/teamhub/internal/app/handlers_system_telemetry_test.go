package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	"github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

type fakeSystemTelemetryManagement struct {
	roomagent.LocalComputerManagement
	snapshot nodeservicesinternal.SystemTelemetrySnapshot
	err      error
	calls    int
}

func (f *fakeSystemTelemetryManagement) LocalComputerSystemTelemetry(_ context.Context, _ roomagent.SystemTelemetryTarget) (nodeservicesinternal.SystemTelemetrySnapshot, error) {
	f.calls++
	return f.snapshot, f.err
}

func TestSampleSystemTelemetryViewStates(t *testing.T) {
	now := time.Now().UTC()
	onlineComputer := agentruntimestate.LocalComputer{
		ComputerID:  "computer_1",
		DisplayName: "Mac mini M6",
		Status:      "online",
		LastSeenAt:  &now,
		Owner:       agentruntimestate.LocalComputerOwner{TenantID: "tenant_1", OwnerActorID: "actor_owner"},
	}
	offlineComputer := onlineComputer
	offlineComputer.Status = "offline"

	fake := &fakeSystemTelemetryManagement{
		snapshot: nodeservicesinternal.SystemTelemetrySnapshot{
			ObservedAt: now,
			Hardware: nodeservicesinternal.SystemTelemetryHardware{
				Architecture: nodeservicesinternal.SystemTelemetryArchitectureUma,
				Platform:     nodeservicesinternal.SystemTelemetryPlatformDarwin,
				Arch:         nodeservicesinternal.SystemTelemetryArchArm64,
				Hostname:     "mac-mini",
				ChipName:     "Apple M6",
				OsLabel:      "macOS 27.2",
				Cpu:          nodeservicesinternal.SystemTelemetryCpu{TotalCores: 12, Clusters: []nodeservicesinternal.SystemTelemetryCpuCluster{}},
				Bandwidth:    nodeservicesinternal.SystemTelemetryBandwidth{Source: nodeservicesinternal.SystemTelemetryBandwidthSourceUnavailable},
			},
			Inference: nodeservicesinternal.SystemTelemetryInference{
				LoadedModels: []nodeservicesinternal.SystemTelemetryLoadedModel{},
				Slots:        []nodeservicesinternal.SystemTelemetrySlot{},
				Requests:     []nodeservicesinternal.SystemTelemetryRequest{},
				Bottleneck: nodeservicesinternal.SystemTelemetryBottleneck{
					Kind:       nodeservicesinternal.SystemTelemetryBottleneckIdle,
					Severity:   nodeservicesinternal.SystemTelemetryBottleneckSeverityInfo,
					ReasonCode: "no_active_inference",
				},
			},
		},
	}
	application := &App{
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		localComputers: fake,
	}

	// Non-owner does not probe the live Computer.
	view, err := application.sampleSystemTelemetryView(context.Background(), onlineComputer, "actor_other")
	if err != nil || view.ViewerIsOwner || view.Telemetry != nil || fake.calls != 0 {
		t.Fatalf("unexpected non-owner view=%+v err=%v calls=%d", view, err, fake.calls)
	}

	// Offline Computer returns online=false without probing.
	view, err = application.sampleSystemTelemetryView(context.Background(), offlineComputer, "actor_owner")
	if err != nil || view.Online || view.Telemetry != nil || fake.calls != 0 {
		t.Fatalf("unexpected offline view=%+v err=%v calls=%d", view, err, fake.calls)
	}

	// Online owned Computer returns live telemetry.
	view, err = application.sampleSystemTelemetryView(context.Background(), onlineComputer, "actor_owner")
	if err != nil || !view.Online || !view.Supported || view.Telemetry == nil || view.Telemetry.Hardware.ChipName != "Apple M6" {
		t.Fatalf("unexpected live view=%+v err=%v", view, err)
	}

	// Older daemon returns supported=false cleanly instead of failing.
	fake.err = &roomagent.SystemTelemetryError{Code: "SYSTEM_TELEMETRY_UNSUPPORTED", Message: "upgrade"}
	view, err = application.sampleSystemTelemetryView(context.Background(), onlineComputer, "actor_owner")
	if err != nil || !view.Online || view.Supported || view.Telemetry != nil {
		t.Fatalf("unexpected unsupported view=%+v err=%v", view, err)
	}

	// Live disconnect returns online=false cleanly.
	fake.err = roomagent.ErrLocalComputerOffline
	view, err = application.sampleSystemTelemetryView(context.Background(), onlineComputer, "actor_owner")
	if err != nil || view.Online || view.Telemetry != nil {
		t.Fatalf("unexpected disconnect view=%+v err=%v", view, err)
	}
}

func TestWriteSystemTelemetryFailureMapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	application := &App{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	run := func(err error) (int, httpapi.ErrorResponse) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("request_id", "req_tel_test")
		application.writeSystemTelemetryFailure(c, "computer_1", err)
		var body httpapi.ErrorResponse
		if decErr := json.Unmarshal(recorder.Body.Bytes(), &body); decErr != nil {
			t.Fatalf("decode response %s: %v", recorder.Body.String(), decErr)
		}
		return recorder.Code, body
	}

	status, body := run(context.DeadlineExceeded)
	if status != http.StatusGatewayTimeout || body.Error.Code != "SYSTEM_TELEMETRY_TIMEOUT" {
		t.Fatalf("deadline -> status=%d code=%s", status, body.Error.Code)
	}
	status, body = run(&roomagent.SystemTelemetryError{Code: "SYSTEM_TELEMETRY_FAILED", Message: "probe err"})
	if status != http.StatusBadGateway || body.Error.Code != "SYSTEM_TELEMETRY_FAILED" {
		t.Fatalf("failed -> status=%d code=%s", status, body.Error.Code)
	}
}
