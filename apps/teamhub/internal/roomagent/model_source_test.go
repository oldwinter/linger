package roomagent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
)

func TestHTTPGatewayAppliesModelSourceAndMapsRefusals(t *testing.T) {
	var status int
	var answer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/tenants/tenant_1/owners/actor_owner/local-computers/computer_1/model-source" {
			t.Fatalf("%s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		byok, _ := body["byok"].(map[string]any)
		if body["mode"] != "byok" || body["runtime"] != "codex" || byok["api_key"] != "sk-test" {
			t.Fatalf("body=%v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(answer))
	}))
	t.Cleanup(server.Close)
	gateway, err := NewHTTPGateway(server.URL, "service-secret", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	target := ModelSourceTarget{TenantID: "tenant_1", OwnerActorID: "actor_owner", ComputerID: "computer_1"}
	runtime := nodeservicesinternal.ModelSourceRuntime("codex")
	key := "sk-test"
	command := nodeservicesinternal.ModelSourceApplyCommand{Mode: "byok", Runtime: &runtime, Byok: &nodeservicesinternal.ByokInput{
		BaseUrl: "https://api.example.com", Path: "/v1", Endpoint: "/responses", Protocol: "openai-responses",
		ApiKey: &key, ModelId: "gpt-5.5",
	}}

	status, answer = http.StatusOK, `{"mode":"byok","runtime":"codex","runtime_model":"localmodels-byok","reasoning_effort":"high","byok":{"configured":true,"key_saved":true}}`
	applied, err := gateway.ApplyLocalComputerModelSource(context.Background(), target, command)
	if err != nil || applied.RuntimeModel != "localmodels-byok" || applied.ReasoningEffort == nil || *applied.ReasoningEffort != "high" {
		t.Fatalf("applied=%+v err=%v", applied, err)
	}
	for _, test := range []struct {
		status int
		body   string
		want   error
		code   string
	}{
		{status: http.StatusNotFound, body: `{"error":{"code":"LOCAL_COMPUTER_NOT_FOUND","message":"gone","request_id":"r"}}`, want: ErrLocalComputerNotFound},
		{status: http.StatusServiceUnavailable, body: `{"error":{"code":"LOCAL_COMPUTER_OFFLINE","message":"off","request_id":"r"}}`, want: ErrLocalComputerOffline},
		{status: http.StatusBadGateway, body: `{"error":{"code":"BYOK_AUTH_FAILED","message":"no","request_id":"r"}}`, code: "BYOK_AUTH_FAILED"},
		{status: http.StatusConflict, body: `{"error":{"code":"RUNTIME_NOT_ENABLED","message":"no","request_id":"r"}}`, code: "RUNTIME_NOT_ENABLED"},
		{status: http.StatusInternalServerError, body: `{}`},
	} {
		status, answer = test.status, test.body
		_, err := gateway.ApplyLocalComputerModelSource(context.Background(), target, command)
		var refusal *ModelSourceError
		switch {
		case test.want != nil && !errors.Is(err, test.want),
			test.code != "" && (!errors.As(err, &refusal) || refusal.Code != test.code || refusal.Message != "no"),
			test.want == nil && test.code == "" && (err == nil || errors.As(err, &refusal)):
			t.Fatalf("status %d: err=%v", test.status, err)
		}
	}
	if _, err := gateway.ApplyLocalComputerModelSource(context.Background(), ModelSourceTarget{TenantID: "tenant 1"}, command); !errors.Is(err, ErrLocalComputerNotFound) {
		t.Fatalf("invalid target err=%v", err)
	}
}

func TestHTTPGatewayListsByokModelsFromTheComputer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/tenants/tenant_1/owners/actor_owner/local-computers/computer_1/model-source/models" {
			t.Fatalf("%s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["api_key"] != "sk-test" ||
			body["base_url"] != "https://api.example.com" || body["path"] != "/api/paas/v4" || body["protocol"] != "openai-chat" {
			t.Fatalf("body=%v err=%v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"url":"https://api.example.com/api/paas/v4/models","models":[{"id":"glm-5","name":"GLM 5","context_window":131072}]}`))
	}))
	t.Cleanup(server.Close)
	gateway, err := NewHTTPGateway(server.URL, "service-secret", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	key := "sk-test"
	list, err := gateway.ListLocalComputerByokModels(context.Background(),
		ModelSourceTarget{TenantID: "tenant_1", OwnerActorID: "actor_owner", ComputerID: "computer_1"},
		nodeservicesinternal.ByokEndpointInput{
			BaseUrl: "https://api.example.com", Path: "/api/paas/v4", Endpoint: "/chat/completions", Protocol: "openai-chat", ApiKey: &key,
		})
	if err != nil || list.Url != "https://api.example.com/api/paas/v4/models" || len(list.Models) != 1 ||
		list.Models[0].ContextWindow == nil || *list.Models[0].ContextWindow != 131072 {
		t.Fatalf("list=%+v err=%v", list, err)
	}
}

func TestHTTPGatewayPropagatesCancelOnByokModelsProbe(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	t.Cleanup(func() {
		close(release)
		server.Close()
	})
	gateway, err := NewHTTPGateway(server.URL, "service-secret", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-started
		cancel()
	}()
	_, err = gateway.ListLocalComputerByokModels(ctx,
		ModelSourceTarget{TenantID: "tenant_1", OwnerActorID: "actor_owner", ComputerID: "computer_1"},
		nodeservicesinternal.ByokEndpointInput{
			BaseUrl: "https://api.example.com", Path: "/v1", Endpoint: "/chat/completions", Protocol: "openai-chat",
		})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}
