package localtools

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/mcpproxy"
)

func cancellationServer(t *testing.T, ctx context.Context, identity mcpproxy.OperationIdentity, call func(context.Context, string, json.RawMessage) (json.RawMessage, error)) *toolServer {
	t.Helper()
	s, err := openToolServer(ctx, identity, []tool{{Name: "test", InputSchema: json.RawMessage(`{"type":"object"}`)}}, call, mcpproxy.LocalToolTimeout)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.server.Close() })
	return s
}

func toolCallRequest(s *toolServer) *http.Request {
	return httptest.NewRequest(http.MethodPost, s.url, strings.NewReader(`{"jsonrpc":"2.0","id":"call","method":"tools/call","params":{"name":"test","arguments":{}}}`))
}

func cancelToolRequest(t *testing.T, s *toolServer) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, s.url, strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"call"}}`))
	response := httptest.NewRecorder()
	s.handle(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("cancellation status: %d", response.Code)
	}
}

func TestToolServerNotificationCancelsBeforeDispatch(t *testing.T) {
	entered := make(chan struct{})
	called := false
	s := cancellationServer(t, t.Context(), mcpproxy.OperationIdentity{BeforeRequest: func(ctx context.Context) error {
		close(entered)
		<-ctx.Done()
		return ctx.Err()
	}}, func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
		called = true
		return json.RawMessage(`{}`), nil
	})
	done := make(chan struct{})
	response := httptest.NewRecorder()
	go func() { defer close(done); s.handle(response, toolCallRequest(s)) }()
	<-entered
	cancelToolRequest(t, s)
	<-done
	if called || !strings.Contains(response.Body.String(), "context canceled") {
		t.Fatalf("cancel dispatched: called=%v response=%s", called, response.Body.String())
	}
}

func TestToolServerRequestCancellationPreservesDispatchedResult(t *testing.T) {
	for _, notification := range []bool{false, true} {
		t.Run(map[bool]string{false: "http", true: "notification"}[notification], func(t *testing.T) {
			entered := make(chan struct{})
			var actionErr error
			s := cancellationServer(t, t.Context(), mcpproxy.OperationIdentity{}, func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
				wait, stop := schedulingContext(ctx)
				defer stop()
				close(entered)
				<-wait.Done()
				actionErr = ctx.Err()
				return json.RawMessage(`{"content":[{"type":"text","text":"confirmed receipt"}]}`), nil
			})
			requestCtx, cancel := context.WithCancel(t.Context())
			defer cancel()
			done := make(chan struct{})
			response := httptest.NewRecorder()
			go func() { defer close(done); s.handle(response, toolCallRequest(s).WithContext(requestCtx)) }()
			<-entered
			if notification {
				cancelToolRequest(t, s)
			} else {
				cancel()
			}
			<-done
			if actionErr != nil || !strings.Contains(response.Body.String(), "confirmed receipt") {
				t.Fatalf("dispatched action canceled: %v, %s", actionErr, response.Body.String())
			}
		})
	}
}

func TestToolServerOperationRevocationStillCancelsDispatchedAction(t *testing.T) {
	operation, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered := make(chan struct{})
	var actionErr error
	s := cancellationServer(t, operation, mcpproxy.OperationIdentity{}, func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		close(entered)
		<-ctx.Done()
		actionErr = ctx.Err()
		return nil, errOutcomeUnknown
	})
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); s.handle(response, toolCallRequest(s)) }()
	<-entered
	cancel()
	<-done
	if !errors.Is(actionErr, context.Canceled) || !strings.Contains(response.Body.String(), errOutcomeUnknown.Error()) {
		t.Fatalf("revocation: %v, %s", actionErr, response.Body.String())
	}
}

func TestToolServerLeavesRuntimeResponseMargin(t *testing.T) {
	var remaining time.Duration
	s := cancellationServer(t, t.Context(), mcpproxy.OperationIdentity{}, func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Error("missing deadline")
		}
		remaining = time.Until(deadline)
		return json.RawMessage(`{}`), nil
	})
	s.handle(httptest.NewRecorder(), toolCallRequest(s))
	if remaining > mcpproxy.LocalToolTimeout-toolResponseMargin || remaining < mcpproxy.LocalToolTimeout-toolResponseMargin-time.Second {
		t.Fatalf("remaining budget: %s", remaining)
	}
}

func TestToolServerCancellationDoesNotNeedARequestSlot(t *testing.T) {
	s := cancellationServer(t, t.Context(), mcpproxy.OperationIdentity{}, nil)
	for range cap(s.slots) {
		s.slots <- struct{}{}
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	s.calls[`"call"`] = cancel
	cancelToolRequest(t, s)
	if ctx.Err() == nil {
		t.Fatal("saturated server lost cancellation")
	}
}

func TestToolServerCallerBudgetOnlyShortensDeadline(t *testing.T) {
	for _, test := range []struct {
		header  string
		want    time.Duration
		refused bool
	}{
		{"120000", 120*time.Second - toolResponseMargin, false},
		{"999999999999999999", mcpproxy.LocalToolTimeout - toolResponseMargin, false},
		{"", 0, true}, {"bad", 0, true}, {"-1", 0, true}, {"5000", 0, true},
	} {
		t.Run(test.header, func(t *testing.T) {
			called := false
			s := cancellationServer(t, t.Context(), mcpproxy.OperationIdentity{}, func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
				called = true
				deadline, _ := ctx.Deadline()
				remaining := time.Until(deadline)
				if remaining > test.want || remaining < test.want-time.Second {
					t.Errorf("remaining=%s, want=%s", remaining, test.want)
				}
				return json.RawMessage(`{}`), nil
			})
			request := toolCallRequest(s)
			request.Header.Set("X-Linger-Tool-Budget-Ms", test.header)
			response := httptest.NewRecorder()
			s.handle(response, request)
			if called == test.refused {
				t.Fatalf("called=%v refused=%v response=%s", called, test.refused, response.Body.String())
			}
		})
	}
}
