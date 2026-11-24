package state_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestConnectHostConcurrentSwitchTransientRecoveryAndMessageOutboxDrain(t *testing.T) {
	srv, err := testutil.NewFakeServer(false)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedAllFixtures()
	defer srv.Close()

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	for _, id := range []string{"host_a", "host_b"} {
		if err := cfgStore.UpsertHost(config.HostProfile{
			ID:             id,
			Name:           "Desktop " + id,
			Mode:           config.HostModeCompanion,
			PrimaryURL:     srv.URL,
			TLS:            false,
			AllowPlainHTTP: true,
		}); err != nil {
			t.Fatalf("UpsertHost: %v", err)
		}
		if err := cfgStore.SaveSecret(id, srv.ValidToken); err != nil {
			t.Fatalf("SaveSecret: %v", err)
		}
	}

	// P1-4: Concurrent ConnectHost calls must not leak SQLite handles or race.
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		hostID := "host_a"
		if i%2 == 1 {
			hostID = "host_b"
		}
		go func(id string) {
			defer wg.Done()
			_ = store.ConnectHost(context.Background(), id)
		}(hostID)
	}
	wg.Wait()

	if err := store.ConnectHost(context.Background(), "host_a"); err != nil {
		t.Fatalf("final ConnectHost(host_a): %v", err)
	}
	if store.Snapshot().Phase != state.PhaseConnected {
		t.Fatalf("expected PhaseConnected, got %s", store.Snapshot().Phase)
	}

	// P1-1: Enqueue an offline message.create entry into SQLite outbox and verify
	// reconnect / DrainMessageOutbox delivers it with structured Segments + ContextMessageIDs.
	cs := store.Cache()
	if cs == nil {
		t.Fatal("expected non-nil cache store")
	}
	replyID := "msg_1"
	// Enqueue directly as SendMessage would while offline.
	if err := cs.EnqueueOutbox(context.Background(), "offline_msg_1", "message.create", "room_general", map[string]any{
		"raw_message":         "Sent after reconnect",
		"segments":            []map[string]string{{"type": "text", "content": "Sent after reconnect"}},
		"context_message_ids": []string{replyID},
	}); err != nil {
		t.Fatalf("EnqueueOutbox: %v", err)
	}
	sent, err := store.DrainMessageOutbox(context.Background())
	if err != nil || sent != 1 {
		t.Fatalf("DrainMessageOutbox: sent=%d err=%v", sent, err)
	}
	msgs, _ := store.RoomMessages("room_general")
	found := false
	for _, m := range msgs {
		if m.RawMessage == "Sent after reconnect" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected drained offline message in room_general, got %d messages", len(msgs))
	}

	// P1-4: Transient initial RefreshActiveHost failure must still start realtime SSE
	// so the store recovers cleanly to PhaseConnected once the server becomes healthy.
	var failGetMe atomic.Bool
	failGetMe.Store(true)
	flaky := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/me" && failGetMe.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"code":"UPSTREAM_UNAVAILABLE","message":"starting up"}}`))
			return
		}
		if r.URL.Path == "/v0/events" {
			flusher, _ := w.(http.Flusher)
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("event: stream.resync\ndata: {\"reason\":\"connected\"}\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
			<-r.Context().Done()
			return
		}
		if r.URL.Path == "/v0/me" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"account":{"id":"acc_1","email":"alex@linger.dev","display_name":"Alex"},"actors":[{"id":"act_1","tenant_id":"ten_1","kind":"human","display_name":"Alex"}]}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[],"page":{"has_more":false}}`))
	}))
	defer func() {
		store.Disconnect()
		flaky.CloseClientConnections()
		flaky.Close()
	}()

	if err := cfgStore.UpsertHost(config.HostProfile{
		ID:             "host_flaky",
		Name:           "Flaky Desktop",
		Mode:           config.HostModeCompanion,
		PrimaryURL:     flaky.URL,
		TLS:            false,
		AllowPlainHTTP: true,
	}); err != nil {
		t.Fatalf("UpsertHost flaky: %v", err)
	}
	_ = cfgStore.SaveSecret("host_flaky", "lmc_tok")

	if err := store.ConnectHost(context.Background(), "host_flaky"); err == nil {
		t.Fatal("expected initial ConnectHost to return transient 503 error")
	}
	failGetMe.Store(false)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if store.Snapshot().Phase == state.PhaseConnected {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("expected ConnectHost to recover from PhaseReconnecting via SSE, stayed in %s", store.Snapshot().Phase)
}
