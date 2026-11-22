package native

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"
)

const (
	// stopHookBridgeTimeout bounds one runtime stop-hook round trip to Agent
	// Service. A slow or disconnected bridge fails open so a Run never hangs.
	stopHookBridgeTimeout = 8 * time.Second
	// maxStopHookBlocks caps how many times stop hooks may block a single Run,
	// guaranteeing termination even if a Runtime misreports stop_hook_active.
	maxStopHookBlocks = 3
)

// StopHookRequest describes a Runtime turn that is about to end.
type StopHookRequest struct {
	Runtime        string
	StopHookActive bool
}

// StopHookDecision is the Agent Service verdict for a Runtime stop attempt.
// Action is "block" (with a non-empty Reason) or "allow".
type StopHookDecision struct {
	Action string `json:"action"`
	Reason string `json:"reason,omitempty"`
}

// StopHookFunc evaluates whether a Runtime may finish its current turn.
type StopHookFunc func(ctx context.Context, request StopHookRequest) StopHookDecision

// NewBridgeStopHook returns a StopHookFunc backed by the Operation's
// HumanInteractionBridge. Every transport error, timeout, cancellation, or
// malformed response fails open (returns allow) so a turn never hangs.
func NewBridgeStopHook(bridge *HumanInteractionBridge, runtimeName string, logger *slog.Logger) StopHookFunc {
	if bridge == nil {
		return nil
	}
	if logger == nil {
		logger = slog.Default()
	}
	var (
		mu      sync.Mutex
		blocked int
	)
	return func(ctx context.Context, request StopHookRequest) StopHookDecision {
		mu.Lock()
		attempt := blocked
		mu.Unlock()
		if attempt >= maxStopHookBlocks {
			return StopHookDecision{Action: "allow"}
		}
		if ctx.Err() != nil {
			return StopHookDecision{Action: "allow"}
		}
		runtime := request.Runtime
		if runtime == "" {
			runtime = runtimeName
		}
		requestID := "stop-hook-" + piRandomHex(12)
		replyCh := make(chan json.RawMessage, 1)
		payload := map[string]any{
			"kind":             "runtime_hook",
			"hook":             "stop",
			"request_id":       requestID,
			"runtime":          runtime,
			"attempt":          attempt,
			"stop_hook_active": request.StopHookActive,
		}
		if err := bridge.Request(requestID, payload, func(raw json.RawMessage) error {
			select {
			case replyCh <- raw:
			default:
			}
			return nil
		}); err != nil {
			logger.Warn("runtime.stop_hook.request_failed", "runtime", runtime, "error", err)
			return StopHookDecision{Action: "allow"}
		}
		defer bridge.Forget(requestID)

		timer := time.NewTimer(stopHookBridgeTimeout)
		defer timer.Stop()
		select {
		case raw := <-replyCh:
			var decision StopHookDecision
			if err := json.Unmarshal(raw, &decision); err != nil {
				logger.Warn("runtime.stop_hook.decode_failed", "runtime", runtime, "error", err)
				return StopHookDecision{Action: "allow"}
			}
			decision.Reason = strings.TrimSpace(decision.Reason)
			if decision.Action == "block" && decision.Reason != "" {
				mu.Lock()
				if blocked >= maxStopHookBlocks {
					mu.Unlock()
					return StopHookDecision{Action: "allow"}
				}
				blocked++
				mu.Unlock()
				return decision
			}
			return StopHookDecision{Action: "allow"}
		case <-timer.C:
			logger.Warn("runtime.stop_hook.timeout", "runtime", runtime, "request_id", requestID)
			return StopHookDecision{Action: "allow"}
		case <-ctx.Done():
			return StopHookDecision{Action: "allow"}
		}
	}
}
