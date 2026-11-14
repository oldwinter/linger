package collaboration

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

func TestMessageModelCarriesRoomSequence(t *testing.T) {
	model, err := messageModel(
		"message_1", "tenant_1", "room_1", pgtype.Int8{Int64: 7, Valid: true},
		"hello", []byte(`[{"type":"text","content":"hello"}]`), "conversation",
		pgtype.Text{}, pgtype.Text{}, pgtype.Text{}, pgtype.Text{},
		pgtype.Timestamptz{Time: time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC), Valid: true},
		store.Actor{ID: "actor_1", TenantID: "tenant_1", Kind: "human", DisplayName: "Alice"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if model.RoomSeq == nil || *model.RoomSeq != 7 {
		t.Fatalf("room_seq=%v want=7", model.RoomSeq)
	}
}

func TestMessageModelOmitsAnUnknownRoomSequence(t *testing.T) {
	model, err := messageModel(
		"message_1", "tenant_1", "room_1", pgtype.Int8{},
		"hello", []byte(`[{"type":"text","content":"hello"}]`), "conversation",
		pgtype.Text{}, pgtype.Text{}, pgtype.Text{}, pgtype.Text{},
		pgtype.Timestamptz{Time: time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC), Valid: true},
		store.Actor{ID: "actor_1", TenantID: "tenant_1", Kind: "human", DisplayName: "Alice"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if model.RoomSeq != nil {
		t.Fatalf("room_seq=%v want nil", model.RoomSeq)
	}
}
