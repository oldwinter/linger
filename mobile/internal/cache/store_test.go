package cache_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
)

func TestCacheMigrationsFTS5AndOutboxDrain(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "host_1.sqlite")

	store, err := cache.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("cache.Open: %v", err)
	}
	defer store.Close()

	// Opening again proves migrations are idempotent.
	store2, err := cache.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("second cache.Open: %v", err)
	}
	_ = store2.Close()

	now := time.Date(2026, 11, 24, 15, 0, 0, 0, time.UTC)
	seq1 := int64(1)
	human := api.ActorRef{ID: "act_1", TenantID: "ten_1", Kind: "human", DisplayName: "Alex"}
	desc := "Release coordination and verification"

	if err := store.UpsertRooms(ctx, []api.RoomListItem{
		{ID: "room_1", TenantID: "ten_1", Name: "Release Launch", Kind: "group", Description: &desc, LatestRoomSeq: 1, CreatedBy: human, CreatedAt: now, UpdatedAt: now},
	}); err != nil {
		t.Fatalf("UpsertRooms: %v", err)
	}
	if err := store.UpsertMessages(ctx, []api.Message{
		{ID: "msg_1", TenantID: "ten_1", RoomID: "room_1", RoomSeq: &seq1, Author: human, MessageKind: "conversation", RawMessage: "Verify SPKI TLS pinning and \u4f60\u597d multilingual search", CreatedAt: now},
	}); err != nil {
		t.Fatalf("UpsertMessages: %v", err)
	}
	if err := store.UpsertWorkItems(ctx, []api.WorkItem{
		{ID: "wi_1", TenantID: "ten_1", Number: 7, Title: "Audit mDNS discovery", Description: "Confirm TXT fp and pair keys", State: "open", Priority: "high", CreatedBy: human, UpdatedBy: human, CreatedAt: now, UpdatedAt: now},
	}); err != nil {
		t.Fatalf("UpsertWorkItems: %v", err)
	}
	if err := store.UpsertPocketNotes(ctx, "ten_1", []api.PocketNote{
		{NoteDate: "2026-11-24", Body: "Remember to rotate device token", UpdatedAt: now},
	}); err != nil {
		t.Fatalf("UpsertPocketNotes: %v", err)
	}
	if err := store.UpsertDocuments(ctx, []api.Document{
		{ID: "doc_1", TenantID: "ten_1", Title: "Companion Wire Protocol", Format: "markdown", CreatedAt: now, UpdatedAt: now},
	}); err != nil {
		t.Fatalf("UpsertDocuments: %v", err)
	}
	if err := store.SaveLocalModelsSnapshot(ctx, "comp_1", api.LocalModelsView{
		Available: true,
		Computer:  api.LocalModelsComputer{ComputerID: "comp_1", DisplayName: "Studio Mac", Online: true},
	}); err != nil {
		t.Fatalf("SaveLocalModelsSnapshot: %v", err)
	}

	// Verify offline cache reads.
	rooms, err := store.ListRooms(ctx, "ten_1")
	if err != nil || len(rooms) != 1 || rooms[0].Name != "Release Launch" {
		t.Fatalf("ListRooms: %+v (%v)", rooms, err)
	}
	msgs, err := store.ListMessages(ctx, "room_1", 10)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("ListMessages: %+v (%v)", msgs, err)
	}
	snap, ok, err := store.LoadLocalModelsSnapshot(ctx, "comp_1")
	if err != nil || !ok || snap.Computer.DisplayName != "Studio Mac" {
		t.Fatalf("LoadLocalModelsSnapshot: %+v ok=%v err=%v", snap, ok, err)
	}

	// Verify instant FTS5 search across English and escaped Unicode text.
	hits, err := store.Search(ctx, "SPKI pinning", 10)
	if err != nil || len(hits) != 1 || hits[0].EntityType != "message" || hits[0].EntityID != "msg_1" {
		t.Fatalf("Search('SPKI pinning'): %+v (%v)", hits, err)
	}
	cjkHits, err := store.Search(ctx, "\u4f60\u597d", 10)
	if err != nil || len(cjkHits) != 1 || cjkHits[0].EntityID != "msg_1" {
		t.Fatalf("Search(unicode): %+v (%v)", cjkHits, err)
	}
	wiHits, err := store.Search(ctx, "mDNS", 10)
	if err != nil || len(wiHits) != 1 || wiHits[0].EntityType != "work_item" {
		t.Fatalf("Search('mDNS'): %+v (%v)", wiHits, err)
	}

	// Verify outbox enqueue idempotency, retry recording, and FIFO drain.
	if err := store.EnqueueOutbox(ctx, "idem_1", "message.create", "room_1", map[string]string{"raw_message": "First"}); err != nil {
		t.Fatalf("EnqueueOutbox 1: %v", err)
	}
	if err := store.EnqueueOutbox(ctx, "idem_1", "message.create", "room_1", map[string]string{"raw_message": "Duplicate"}); err != nil {
		t.Fatalf("EnqueueOutbox duplicate: %v", err)
	}
	if err := store.EnqueueOutbox(ctx, "idem_2", "message.create", "room_1", map[string]string{"raw_message": "Second"}); err != nil {
		t.Fatalf("EnqueueOutbox 2: %v", err)
	}

	queued, err := store.ListOutbox(ctx)
	if err != nil || len(queued) != 2 {
		t.Fatalf("expected 2 outbox items, got %d (%v)", len(queued), err)
	}

	// First drain fails on item 2 -> item 1 acked, item 2 remains with attempts=1.
	calls := 0
	sent, drainErr := store.DrainOutbox(ctx, func(_ context.Context, item cache.OutboxItem) error {
		calls++
		if item.IdempotencyKey == "idem_2" {
			return errors.New("temporary offline")
		}
		return nil
	})
	if drainErr == nil || sent != 1 {
		t.Fatalf("expected partial drain sent=1 err!=nil, got sent=%d err=%v", sent, drainErr)
	}
	remaining, err := store.ListOutbox(ctx)
	if err != nil || len(remaining) != 1 || remaining[0].Attempts != 1 || remaining[0].LastError != "temporary offline" {
		t.Fatalf("unexpected remaining outbox: %+v (%v)", remaining, err)
	}

	// Second drain succeeds for remaining item.
	sent, drainErr = store.DrainOutbox(ctx, func(_ context.Context, _ cache.OutboxItem) error { return nil })
	if drainErr != nil || sent != 1 {
		t.Fatalf("expected final drain sent=1 err=nil, got sent=%d err=%v", sent, drainErr)
	}
	stats, err := store.Stats(ctx)
	if err != nil || stats.Rooms != 1 || stats.Messages != 1 || stats.WorkItems != 1 || stats.Outbox != 0 {
		t.Fatalf("unexpected cache stats: %+v (%v)", stats, err)
	}
}
