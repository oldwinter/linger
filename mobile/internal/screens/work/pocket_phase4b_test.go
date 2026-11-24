package work_test

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/screens/work"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestSyncPocketOutboxPreservesMessagesAndSerializesConcurrentSaves(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(false)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	cl, err := srv.NewClient()
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	cs, err := cache.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("cache.Open: %v", err)
	}
	defer func() { _ = cs.Close() }()

	// Seed an offline chat message in the shared outbox table (P1-1).
	if err := cs.EnqueueOutbox(context.Background(), "chat_msg_preserve", "message.create", "room_1", map[string]any{
		"raw_message": "Never delete me",
		"segments":    []map[string]string{{"type": "text", "content": "Never delete me"}},
	}); err != nil {
		t.Fatalf("EnqueueOutbox message.create: %v", err)
	}

	var online atomic.Bool
	online.Store(false)

	scr := work.New(work.Deps{
		Client:   cl,
		Cache:    cs,
		TenantID: srv.TenantID,
		Online:   func() bool { return online.Load() },
	})
	defer scr.Close()

	// Rapid concurrent offline edits while disconnected (P1-3).
	for i := 1; i <= 20; i++ {
		scr.SavePocketNoteDraft(fmt.Sprintf("Draft revision %d", i))
	}
	time.Sleep(150 * time.Millisecond)

	// Come back online and race SyncPocketOutbox against final online edits.
	online.Store(true)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_ = scr.SyncPocketOutbox(context.Background())
	}()
	go func() {
		defer wg.Done()
		scr.SavePocketNoteDraft("Final winning pocket note")
	}()
	wg.Wait()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		st, pending := scr.CurrentPocketState()
		if st == work.PocketStateSaved && pending == 0 {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	_ = scr.SyncPocketOutbox(context.Background())

	// P1-1: Verify the queued "message.create" item is STILL intact in outbox_queue!
	remaining, err := cs.ListOutbox(context.Background())
	if err != nil {
		t.Fatalf("ListOutbox: %v", err)
	}
	foundChat := false
	for _, it := range remaining {
		if it.IdempotencyKey == "chat_msg_preserve" && it.Kind == "message.create" {
			foundChat = true
		}
	}
	if !foundChat {
		t.Fatalf("SyncPocketOutbox destroyed queued message.create outbox entry! remaining=%+v", remaining)
	}
}
