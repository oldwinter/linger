package realtime

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/oldwinter/linger/mobile/internal/api"
)

// RunStatusEventPayload is the structured payload carried on agent_run.status_changed room events.
type RunStatusEventPayload struct {
	RunID        string `json:"run_id"`
	Status       string `json:"status"`
	EventOrdinal int64  `json:"event_ordinal"`
	Replied      bool   `json:"replied"`
	StopReason   string `json:"stop_reason,omitempty"`
}

// RunPresentationTracker reacts to agent_run.status_changed events and
// incrementally pulls GET /v0/rooms/:id/runs/:runId/runtime-presentation-events?after=<ordinal>.
type RunPresentationTracker struct {
	client  *api.Client
	onEvent func(roomID, runID string, ev api.RuntimePresentationEvent)

	mu       sync.Mutex
	ordinals map[string]int64
}

// NewRunPresentationTracker creates a RunPresentationTracker.
func NewRunPresentationTracker(client *api.Client, onEvent func(roomID, runID string, ev api.RuntimePresentationEvent)) *RunPresentationTracker {
	return &RunPresentationTracker{
		client:   client,
		onEvent:  onEvent,
		ordinals: map[string]int64{},
	}
}

// LastOrdinal returns the highest committed presentation event ordinal pulled for runID.
func (t *RunPresentationTracker) LastOrdinal(runID string) int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.ordinals[runID]
}

// HandleRoomEvent inspects a room.event envelope and pulls incremental
// runtime presentation events when event_type == "agent_run.status_changed".
func (t *RunPresentationTracker) HandleRoomEvent(ctx context.Context, ev api.RoomEventEnvelope) error {
	if ev.EventType != "agent_run.status_changed" {
		return nil
	}
	var payload RunStatusEventPayload
	if err := json.Unmarshal(ev.Payload, &payload); err != nil || payload.RunID == "" {
		return nil
	}
	if payload.EventOrdinal > 0 && payload.EventOrdinal <= t.LastOrdinal(payload.RunID) {
		return nil
	}
	return t.SyncRun(ctx, ev.RoomID, payload.RunID)
}

// SyncRun pulls any presentation events committed after the last seen ordinal for runID.
func (t *RunPresentationTracker) SyncRun(ctx context.Context, roomID, runID string) error {
	after := t.LastOrdinal(runID)
	page, err := t.client.ListRoomRuntimePresentationEvents(ctx, roomID, runID, after)
	if err != nil {
		return err
	}
	maxOrd := after
	for i, raw := range page.Items {
		var parsed api.RuntimePresentationEvent
		_ = json.Unmarshal(raw, &parsed)
		parsed.Raw = raw
		ord := parsed.EffectiveOrdinal()
		if ord == 0 {
			ord = after + int64(i+1)
			parsed.EventOrdinal = ord
		}
		if ord <= maxOrd {
			continue
		}
		maxOrd = ord
		if t.onEvent != nil {
			t.onEvent(roomID, runID, parsed)
		}
	}
	if page.PublishedThroughOrdinal > maxOrd {
		maxOrd = page.PublishedThroughOrdinal
	}
	t.mu.Lock()
	if maxOrd > t.ordinals[runID] {
		t.ordinals[runID] = maxOrd
	}
	t.mu.Unlock()
	return nil
}
