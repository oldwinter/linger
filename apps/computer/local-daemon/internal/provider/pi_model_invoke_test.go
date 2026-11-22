package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestModelInvokerPi(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture launches the POSIX pnpm Pi shim")
	}
	const structuredReply, textReply = `{"answer":"local"}`, "Local model reply."
	pi, err := filepath.Abs("../../../node_modules/.bin/pi")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(pi); err != nil {
		t.Skip("install Computer's pinned Pi with pnpm install to run the local endpoint fixture")
	}
	root := t.TempDir()
	payloads := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var payload json.RawMessage
		if req.URL.Path != "/v1/chat/completions" || json.NewDecoder(req.Body).Decode(&payload) != nil {
			t.Error("unexpected Pi model request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		select {
		case payloads <- string(payload):
		default:
			t.Error("unexpected additional local model request")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		reply := textReply
		if strings.Contains(string(payload), "matching this schema") {
			reply = structuredReply
		}
		if _, err := fmt.Fprintf(w, `data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":%q},"finish_reason":null}]}

data: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

`, reply); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("models.json", fmt.Sprintf(`{"providers":{"local-fixture":{"baseUrl":%q,"api":"openai-completions","apiKey":"fixture","models":[{"id":"fixture"}]}}}`, server.URL+"/v1"))
	write("settings.json", `{"defaultProvider":"local-fixture","defaultModel":"fixture"}`)
	invoker := ModelInvoker{
		TempBase: root,
		Lookup: func(_ context.Context, runtime string) (ModelInvokeRuntime, bool, error) {
			return ModelInvokeRuntime{
				ExecutablePath: pi,
				Environment:    map[string]string{"HOME": root, "PI_CODING_AGENT_DIR": root, "PATH": os.Getenv("PATH")},
			}, runtime == "pi", nil
		},
	}
	for _, mode := range []string{ModelInvokeStructured, ModelInvokeText} {
		t.Run(mode, func(t *testing.T) {
			request := ModelInvokeRequest{RuntimeType: "pi", Mode: mode, ReasoningEffort: "low", Instructions: "Fixture instructions.", Input: "Fixture source.", Timeout: 15 * time.Second}
			want := textReply
			if mode == ModelInvokeStructured {
				want = structuredReply
				request.OutputSchema = json.RawMessage(`{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}`)
			}
			result := invoker.Invoke(t.Context(), request)
			if result.Outcome != ModelInvokeCompleted || result.Text != want || result.Model != "local-fixture/fixture" {
				t.Fatalf("Pi invocation = %+v", result)
			}
			payload := <-payloads
			if !strings.Contains(payload, "Fixture source.") || !strings.Contains(payload, "Fixture instructions.") ||
				strings.Contains(payload, `"tools":[{`) ||
				(mode == ModelInvokeStructured) != strings.Contains(payload, "matching this schema") {
				t.Fatalf("unexpected request: %s", payload)
			}
		})
	}
	t.Run("file tools are not enabled", func(t *testing.T) {
		result := invoker.Invoke(t.Context(), ModelInvokeRequest{RuntimeType: "pi", Mode: ModelInvokeWorkspace, Input: "Must not be sent.", Timeout: 15 * time.Second})
		if result.Outcome != ModelInvokeRuntimeUnavailable || !strings.Contains(result.Reason, "file tools") {
			t.Fatalf("Pi invocation = %+v", result)
		}
		select {
		case <-payloads:
			t.Fatal("sent a prompt for a workspace call")
		default:
		}
	})
}
