package localtools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestUnifiedUICancellationDrainsDispatchedAction(t *testing.T) {
	for _, notification := range []bool{false, true} {
		name := "HTTP"
		if notification {
			name = "MCPNotification"
		}
		t.Run(name, func(t *testing.T) {
			entered := make(chan context.Context, 1)
			release := make(chan struct{})
			completed := make(chan error, 1)
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			defer unblock()
			var calls atomic.Int32
			f := newUIRuntimeFixture(t, false, func(ctx context.Context, name string, _ json.RawMessage) (json.RawMessage, error) {
				if name != "browser_click" {
					return uiTextResult("read"), nil
				}
				if calls.Add(1) != 1 {
					return uiTextResult("unexpected second dispatch"), nil
				}
				entered <- ctx
				select {
				case <-release:
					completed <- ctx.Err()
					return uiTextResult("confirmed first click"), nil
				case <-ctx.Done():
					completed <- ctx.Err()
					return nil, ctx.Err()
				}
			})
			clear, err := f.set.RegisterToolReviewer(nil)
			if err != nil {
				t.Fatal(err)
			}
			defer clear()
			before := cancellationSummary(t, f.execute(t, `state.marker="old"; return 1;`))
			requestCtx, cancel := context.WithCancel(t.Context())
			defer cancel()
			id := f.sequence.Add(1)
			body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": map[string]any{"name": "ui_exec", "arguments": map[string]any{"code": `await ui.browser.click({}); await ui.browser.click({});`, "timeout_ms": 30000}}})
			type response struct {
				data []byte
				err  error
			}
			responseCh := make(chan response, 1)
			go func() { data, _, err := cancellationPost(requestCtx, f.url, body); responseCh <- response{data, err} }()
			var actionCtx context.Context
			select {
			case actionCtx = <-entered:
			case result := <-responseCh:
				t.Fatalf("execution ended before callback: err=%v body=%s", result.err, result.data)
			case <-time.After(10 * time.Second):
				t.Fatal("first callback did not start")
			}
			if notification {
				notice, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "notifications/cancelled", "params": map[string]any{"requestId": id}})
				data, status, err := cancellationPost(t.Context(), f.url, notice)
				if err != nil || status != http.StatusAccepted {
					t.Fatalf("notification: status=%d err=%v body=%s", status, err, data)
				}
			} else {
				cancel()
				select {
				case result := <-responseCh:
					if !errors.Is(result.err, context.Canceled) {
						t.Fatalf("HTTP cancellation error=%v body=%s", result.err, result.data)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("HTTP request did not cancel")
				}
			}
			// The in-flight callback must retain its hard deadline while the scheduler stops.
			select {
			case <-actionCtx.Done():
				t.Fatalf("soft cancellation reached callback: %v", actionCtx.Err())
			case <-time.After(150 * time.Millisecond):
			}
			if calls.Load() != 1 {
				t.Fatalf("second action dispatched before release: %d", calls.Load())
			}
			unblock()
			select {
			case err := <-completed:
				if err != nil {
					t.Fatalf("callback did not finish normally: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("callback did not finish")
			}
			if notification {
				select {
				case result := <-responseCh:
					if result.err != nil {
						t.Fatal(result.err)
					}
					var envelope struct {
						Result json.RawMessage `json:"result"`
					}
					if err := json.Unmarshal(result.data, &envelope); err != nil {
						t.Fatal(err)
					}
					summary := cancellationSummary(t, envelope.Result)
					if !summary.IsError || !summary.Structured.StateReset || summary.Structured.Error == "" || len(summary.Structured.Receipts) != 1 || summary.Structured.Receipts[0].Status != "confirmed" || !strings.Contains(string(result.data), "confirmed first click") {
						t.Fatalf("completion receipt lost: %s", result.data)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("cancelled execution did not return its receipt")
				}
			}
			// HTTP cancellation has no response to await. A pure read may see busy until
			// callback transport and process cleanup finish; it must never run old state.
			deadline := time.Now().Add(5 * time.Second)
			for {
				result := f.execute(t, `return typeof state.marker;`)
				if strings.Contains(string(result), "busy") && time.Now().Before(deadline) {
					time.Sleep(10 * time.Millisecond)
					continue
				}
				after := cancellationSummary(t, result)
				if after.IsError || after.Structured.Generation <= before.Structured.Generation || string(after.Structured.Value) != `"undefined"` {
					t.Fatalf("runtime did not recover without stale state: %s", result)
				}
				break
			}
			if calls.Load() != 1 {
				t.Fatalf("cancelled second action dispatched: %d", calls.Load())
			}
		})
	}
}

type uiCancellationSummary struct {
	IsError    bool `json:"isError"`
	Structured struct {
		Generation uint64          `json:"generation"`
		Value      json.RawMessage `json:"value"`
		StateReset bool            `json:"state_reset"`
		Error      string          `json:"error"`
		Receipts   []struct {
			Status string `json:"status"`
		} `json:"receipts"`
	} `json:"structuredContent"`
}

func cancellationSummary(t *testing.T, data json.RawMessage) uiCancellationSummary {
	t.Helper()
	var result uiCancellationSummary
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("invalid UI response: %s (%v)", data, err)
	}
	return result
}
func cancellationPost(ctx context.Context, url string, body []byte) ([]byte, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	return data, response.StatusCode, err
}
