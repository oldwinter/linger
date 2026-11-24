package realtime_test

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/realtime"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestStreamManagerEventsGapBackfillInvalidationResyncAndExpiry(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          srv.ValidToken,
		TLSFingerprint: srv.Fingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var (
		mu          sync.Mutex
		gotSeqs     []int64
		gotInvs     []realtime.ResourceInvalidation
		gotResyncs  []string
		expiredCode string
		heartbeats  int
	)
	connectedCh := make(chan struct{}, 2)
	allBackfillCh := make(chan struct{}, 1)
	invCh := make(chan struct{}, 1)
	expiredCh := make(chan struct{}, 1)

	mgr := realtime.NewStreamManager(client, realtime.StreamCallbacks{
		OnState: func(st realtime.StreamState, _ error) {
			if st == realtime.StateConnected {
				select {
				case connectedCh <- struct{}{}:
				default:
				}
			}
		},
		OnRoomEvent: func(ev api.RoomEventEnvelope) {
			mu.Lock()
			gotSeqs = append(gotSeqs, ev.RoomSeq)
			done := len(gotSeqs) >= 3
			mu.Unlock()
			if done {
				select {
				case allBackfillCh <- struct{}{}:
				default:
				}
			}
		},
		OnInvalidated: func(inv realtime.ResourceInvalidation) {
			mu.Lock()
			gotInvs = append(gotInvs, inv)
			mu.Unlock()
			select {
			case invCh <- struct{}{}:
			default:
			}
		},
		OnResync: func(reason string) {
			mu.Lock()
			gotResyncs = append(gotResyncs, reason)
			mu.Unlock()
		},
		OnHeartbeat: func(time.Time) {
			mu.Lock()
			heartbeats++
			mu.Unlock()
		},
		OnSessionExpired: func(code, _ string) {
			mu.Lock()
			expiredCode = code
			mu.Unlock()
			select {
			case expiredCh <- struct{}{}:
			default:
			}
		},
	}, realtime.StreamOptions{
		BaseBackoff: 50 * time.Millisecond,
		MaxBackoff:  200 * time.Millisecond,
	})

	// Track room_general starting at seq 2.
	mgr.SetRoomCursor("room_general", 2)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	doneCh := make(chan error, 1)
	go func() { doneCh <- mgr.Run(ctx) }()

	select {
	case <-connectedCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for SSE connected")
	}

	// Push heartbeat comment.
	srv.PushSSE(testutil.SSEFrame{Comment: "heartbeat"})

	// Append seq 3 & seq 4 without broadcasting, then push seq 5 -> triggers gap backfill (3, 4, 5)!
	now := time.Now().UTC()
	srv.AppendRoomEvent(api.RoomEventEnvelope{EventID: "evt_3", TenantID: "ten_1", RoomID: "room_general", RoomSeq: 3, EventType: "message.created", OccurredAt: now, Payload: json.RawMessage(`{}`)}, false)
	srv.AppendRoomEvent(api.RoomEventEnvelope{EventID: "evt_4", TenantID: "ten_1", RoomID: "room_general", RoomSeq: 4, EventType: "message.created", OccurredAt: now, Payload: json.RawMessage(`{}`)}, false)
	srv.AppendRoomEvent(api.RoomEventEnvelope{EventID: "evt_5", TenantID: "ten_1", RoomID: "room_general", RoomSeq: 5, EventType: "message.created", OccurredAt: now, Payload: json.RawMessage(`{}`)}, true)

	select {
	case <-allBackfillCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for gap-backfilled room events")
	}

	mu.Lock()
	if len(gotSeqs) != 3 || gotSeqs[0] != 3 || gotSeqs[1] != 4 || gotSeqs[2] != 5 {
		t.Fatalf("expected contiguous backfilled seqs [3 4 5], got %v", gotSeqs)
	}
	if len(gotResyncs) == 0 || gotResyncs[0] != "connected" {
		t.Fatalf("expected initial stream.resync connected, got %v", gotResyncs)
	}
	mu.Unlock()

	// Push resource.invalidated.
	srv.PushSSE(testutil.SSEFrame{
		Event: "resource.invalidated",
		Data:  `{"tenant_id":"ten_1","resource":"work_item","id":"wi_1"}`,
	})
	select {
	case <-invCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for resource.invalidated")
	}
	mu.Lock()
	if len(gotInvs) != 1 || gotInvs[0].Resource != "work_item" {
		t.Fatalf("unexpected invalidations: %+v", gotInvs)
	}
	mu.Unlock()

	// Push session.expired -> stream should stop cleanly with StateExpired.
	srv.PushSSE(testutil.SSEFrame{
		Event: "session.expired",
		Data:  `{"code":"SESSION_EXPIRED","message":"session expired"}`,
	})
	select {
	case <-expiredCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for session.expired")
	}
	select {
	case <-doneCh:
	case <-time.After(2 * time.Second):
		t.Fatal("expected StreamManager.Run to stop after session.expired")
	}
	if mgr.State() != realtime.StateExpired {
		t.Fatalf("expected StateExpired, got %s", mgr.State())
	}
	mu.Lock()
	if expiredCode != "SESSION_EXPIRED" {
		t.Fatalf("expected SESSION_EXPIRED, got %q", expiredCode)
	}
	mu.Unlock()
}

func TestRunPresentationTrackerAndVoiceSessionStream(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          srv.ValidToken,
		TLSFingerprint: srv.Fingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var gotEvents []api.RuntimePresentationEvent
	tracker := realtime.NewRunPresentationTracker(client, func(_, _ string, ev api.RuntimePresentationEvent) {
		gotEvents = append(gotEvents, ev)
	})

	ev := api.RoomEventEnvelope{
		RoomID:    "room_general",
		EventType: "agent_run.status_changed",
		Payload:   json.RawMessage(`{"run_id":"run_1","status":"active","event_ordinal":2}`),
	}
	if err := tracker.HandleRoomEvent(context.Background(), ev); err != nil {
		t.Fatalf("HandleRoomEvent: %v", err)
	}
	if len(gotEvents) != 2 || tracker.LastOrdinal("run_1") != 2 {
		t.Fatalf("expected 2 initial presentation events (ordinal 2), got %d (ord %d)", len(gotEvents), tracker.LastOrdinal("run_1"))
	}

	// Appending ordinal 3 pulls only the new delta.
	srv.AppendPresentationEvent("run_1", json.RawMessage(`{"event_ordinal":3,"type":"activity_finished","title":"Run test suite","status":"succeeded"}`))
	ev3 := api.RoomEventEnvelope{
		RoomID:    "room_general",
		EventType: "agent_run.status_changed",
		Payload:   json.RawMessage(`{"run_id":"run_1","status":"completed","event_ordinal":3}`),
	}
	if err := tracker.HandleRoomEvent(context.Background(), ev3); err != nil {
		t.Fatalf("HandleRoomEvent delta: %v", err)
	}
	if len(gotEvents) != 3 || tracker.LastOrdinal("run_1") != 3 {
		t.Fatalf("expected 3 total presentation events (ordinal 3), got %d (ord %d)", len(gotEvents), tracker.LastOrdinal("run_1"))
	}

	// Test VoiceSessionStream.
	voiceCtx, voiceCancel := context.WithCancel(context.Background())
	defer voiceCancel()
	readyCh := make(chan struct{}, 1)
	partialCh := make(chan string, 1)
	vs := realtime.NewVoiceSessionStream(client, "vs_1", realtime.VoiceStreamCallbacks{
		OnReady: func() {
			select {
			case readyCh <- struct{}{}:
			default:
			}
		},
		OnPartial: func(p api.VoiceTranscriptEventPage) {
			if p.PartialTranscript != nil {
				partialCh <- *p.PartialTranscript
			}
		},
	})
	go func() { _ = vs.RunOnce(voiceCtx) }()

	select {
	case <-readyCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for voice.ready")
	}
	srv.PushVoiceSSE(testutil.SSEFrame{
		Event: "voice.partial",
		ID:    "cur_42",
		Data:  `{"items":[],"partial_transcript":"Checking deploy status"}`,
	})
	select {
	case text := <-partialCh:
		if text != "Checking deploy status" {
			t.Fatalf("unexpected voice partial: %q", text)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for voice.partial")
	}
	if vs.Cursor() != "cur_42" {
		t.Fatalf("expected voice cursor cur_42, got %q", vs.Cursor())
	}
}
