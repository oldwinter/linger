package roomagent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPGatewayLocalComputerSystemTelemetry(t *testing.T) {
	var status int
	var payload any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/tenants/tenant_1/owners/actor_1/local-computers/computer_1/system-telemetry" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer server.Close()

	gateway, err := NewHTTPGateway(server.URL, "secret-token", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	target := SystemTelemetryTarget{TenantID: "tenant_1", OwnerActorID: "actor_1", ComputerID: "computer_1"}

	status = http.StatusOK
	payload = map[string]any{
		"observed_at": "2026-11-27T01:00:00Z",
		"hardware": map[string]any{
			"architecture": "uma", "platform": "darwin", "arch": "arm64",
			"hostname": "mac", "chip_name": "Apple M6", "os_label": "macOS 27.2",
			"memory":    map[string]any{"total_bytes": 1000, "used_bytes": 500, "model_weights_bytes": 0, "kv_cache_bytes": 0, "compute_buffer_bytes": 0, "os_wired_bytes": 200, "active_apps_bytes": 200, "compressed_bytes": 100, "free_headroom_bytes": 500, "system_ram_total_bytes": 1000, "system_ram_used_bytes": 500, "system_ram_available_bytes": 500},
			"bandwidth": map[string]any{"source": "unavailable"},
			"disk":      map[string]any{},
			"cpu":       map[string]any{"total_cores": 12, "clusters": []any{}},
			"gpu":       map[string]any{},
			"power":     map[string]any{},
			"thermal":   map[string]any{"throttling": false},
		},
		"inference": map[string]any{
			"prefill_tok_s": 0, "decode_tok_s": 0, "active_requests_count": 0, "queued_requests_count": 0,
			"active_slots": 0, "total_slots": 0, "kv_cache_tokens_used": 0, "kv_cache_tokens_capacity": 0, "total_tokens_session": 0,
			"loaded_models": []any{}, "slots": []any{}, "requests": []any{},
			"bottleneck": map[string]any{"kind": "idle", "severity": "info", "reason_code": "no_active_inference"},
		},
	}
	snap, err := gateway.LocalComputerSystemTelemetry(context.Background(), target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap.Hardware.ChipName != "Apple M6" || snap.Inference.Bottleneck.Kind != "idle" {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}

	// Offline refusal maps to ErrLocalComputerOffline.
	status = http.StatusServiceUnavailable
	payload = map[string]any{"error": map[string]any{"code": "LOCAL_COMPUTER_OFFLINE", "message": "offline", "request_id": "req_1"}}
	if _, err := gateway.LocalComputerSystemTelemetry(context.Background(), target); !errors.Is(err, ErrLocalComputerOffline) {
		t.Fatalf("expected ErrLocalComputerOffline, got %v", err)
	}

	// Unsupported daemon maps to SystemTelemetryError.
	status = http.StatusConflict
	payload = map[string]any{"error": map[string]any{"code": "SYSTEM_TELEMETRY_UNSUPPORTED", "message": "upgrade", "request_id": "req_2"}}
	var telErr *SystemTelemetryError
	if _, err := gateway.LocalComputerSystemTelemetry(context.Background(), target); !errors.As(err, &telErr) || telErr.Code != "SYSTEM_TELEMETRY_UNSUPPORTED" {
		t.Fatalf("expected SYSTEM_TELEMETRY_UNSUPPORTED, got %v", err)
	}
}
